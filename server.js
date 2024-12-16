const express = require("express");
const cors = require("cors");
const multer = require("multer");
const ImageKit = require("imagekit");
const bodyParser = require("body-parser");
const { google } = require("googleapis");
const { createClient } = require("@libsql/client");

require('dotenv').config();

const app = express();


// Configure CORS
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "http://localhost:3000", // Configurable CORS origin
    methods: ["GET", "POST", "PUT", "DELETE"], // Allowed HTTP methods
    credentials: true, // Include credentials if necessary
  })
);

// Middleware
app.use(bodyParser.json());

// Database client
const db = createClient({
  url: process.env.TURSO_DB_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// ImageKit configuration
const imagekit = new ImageKit({
  publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
  privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
  urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT,
});

// Multer storage setup
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Variables to track last uploaded files for each class
let generalTimetableFiles = {};
let examTimetableFiles = {};

// Helper function to pad numbers
function padNumber(num) {
  const size = 4; // Desired number length
  let numStr = num.toString();
  while (numStr.length < size) {
    numStr = "0" + numStr;
  }
  return numStr;
}

// Helper function to upload file
const uploadFile = (fileBuffer, fileName, folder, onSuccess, onError) => {
  imagekit.upload(
    {
      file: fileBuffer,
      fileName: fileName,
      folder: folder,
    },
    (error, result) => {
      if (error) {
        onError(error);
      } else {
        onSuccess(result);
      }
    }
  );
};

// Helper function to delete file
const deleteFile = (fileId, onSuccess, onError) => {
  if (!fileId) {
    return onError("No file ID provided.");
  }

  imagekit.deleteFile(fileId, (error) => {
    if (error) {
      onError(error);
    } else {
      onSuccess();
    }
  });
};

// Utility: Get current date in IST format
const getISTDate = () => {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000; // IST offset
  const istTime = new Date(now.getTime() + istOffset);
  const year = istTime.getUTCFullYear();
  const month = String(istTime.getUTCMonth() + 1).padStart(2, "0");
  const day = String(istTime.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

// Middleware: Validate request body
const validateRequestBody = (keys) => (req, res, next) => {
  const missingKeys = keys.filter((key) => !req.body[key]);
  if (missingKeys.length > 0) {
    return res.status(400).json({ error: `Missing required fields: ${missingKeys.join(", ")}` });
  }
  next();
};

// Routes
// Route to register a student
app.post("/register", async (req, res) => {
  const {
    firstName,
    lastName,
    gender,
    dob,
    address,
    parentName,
    parentEmail,
    parentContact,
    cast,
    region,
    yearOfAdmission,
  } = req.body;

  try {
    // Get the current student count
    const result = await db.execute("SELECT COUNT(*) FROM `Student-info`");
    const studentCount = result.rows[0]["COUNT(*)"];
    console.log("Student count:", studentCount);

    // Generate a unique roll number
    const studentid = "S" + yearOfAdmission + padNumber(studentCount + 1);

    // Check if the roll number already exists
    const existingStudent = await db.execute({
      sql: `SELECT rollNumber FROM "Student-info" WHERE rollNumber = ?`,
      args: [studentid],
    });
    if (existingStudent.rows.length > 0) {
      return res.status(400).send({ error: "Roll number already exists" });
    }

    await db.execute({
      sql: `INSERT INTO "Student-info" (rollNumber, firstName, lastName, gender, dob, address, parentName, parentEmail, parentContact, cast, region, yearOfAdmission)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        studentid,
        firstName,
        lastName,
        gender,
        dob,
        address,
        parentName,
        parentEmail,
        parentContact,
        cast,
        region,
        yearOfAdmission,
      ],
    });

    res.status(201).send("Student registered successfully");
  } catch (error) {
    console.error("Error registering student:", error);
    res.status(500).send({ error: "Registration failed" });
  }
});

// Route to fetch all students
app.get("/allstudents", async (req, res) => {
  try {
    // Fetch all students from the database
    const result = await db.execute("SELECT * FROM `Student-info`");
    console.log("Fetched students:", result.rows);

    // Send the result as a response
    res.status(200).json(result.rows);
  } catch (error) {
    console.error("Error fetching students:", error);
    res.status(500).send("Failed to retrieve students");
  }
});


app.put("/updateStudent/:rollNumber", async (req, res) => {
  const rollNumber = req.params.rollNumber;
  const {
    firstName,
    lastName,
    gender,
    dob,
    address,
    parentName,
    parentEmail,
    parentContact,
    cast,
    region,
    yearOfAdmission,
  } = req.body;

  try {
    await db.execute({
      sql: `UPDATE "Student-info" SET firstName = ?, lastName = ?, gender = ?, dob = ?, address = ?, parentName = ?, parentEmail = ?, parentContact = ?, cast = ?, region = ?, yearOfAdmission = ? WHERE rollNumber = ?`,
      args: [
        firstName,
        lastName,
        gender,
        dob,
        address,
        parentName,
        parentEmail,
        parentContact,
        cast,
        region,
        yearOfAdmission,
        rollNumber,
      ],
    });

    res.status(200).send("Student details updated successfully");
  } catch (error) {
    console.error("Error updating student:", error);
    res.status(500).send("Failed to update student details");
  }
});

// Route to get the number of registered students
app.get("/studentcount", async (req, res) => {
  try {
    // Fetch the count of students from the database
    const result = await db.execute("SELECT COUNT(*) FROM `Student-info`");
    const studentCount = result.rows[0]["COUNT(*)"];
    console.log("Student count:", studentCount);

    // Send the student count as a response
    res.status(200).json({ studentCount });
  } catch (error) {
    console.error("Error fetching student count:", error);
    res.status(500).send("Failed to fetch student count");
  }
});

// Student Registration end here

// Fee Update Start From Here
// New route to update fee status UPDATED FROM HERE
app.put("/updateFeeStatus/:rollNumber", async (req, res) => {
  const { rollNumber } = req.params;
  const { feeStatus } = req.body;

  // Validate fee status
  if (!["PAID", "UNPAID", "PARTIALLY PAID"].includes(feeStatus)) {
    return res.status(400).send({ error: "Invalid fee status" });
  }

  try {
    // Update fee status for the specified student
    await db.execute({
      sql: `UPDATE "Student-info" SET feeStatus = ? WHERE rollNumber = ?`,
      args: [feeStatus, rollNumber],
    });
    res.status(200).send("Fee status updated successfully");
  } catch (error) {
    console.error("Error updating fee status:", error);
    res.status(500).send({ error: "Failed to update fee status" });
  }
});

// New route to fetch students with fee status
app.get("/studentsWithFeeStatus", async (req, res) => {
  try {
    // Fetch roll number, name, and fee status for all students
    const result = await db.execute(
      `SELECT rollNumber, firstName, lastName, feeStatus FROM "Student-info"`
    );
    res.status(200).json(result.rows);
  } catch (error) {
    console.error("Error fetching students with fee status:", error);
    res.status(500).send("Failed to retrieve data");
  }
});

// Fee Update End From here


// Marks code Start From Here

app.get("/allexamreport", async (req, res) => {
  try {
    // Execute the query to fetch all students from the "Student_Marks" table
    const result = await db.execute("SELECT * FROM `Student_Marks`");
    // Send the result as a response
    res.status(200).json(result.rows);
  } catch (error) {
    console.error("Error fetching students:", error);
    res.status(500).send("Failed to retrieve students");
  }
});

// Get exam report for a single student by roll number (with name)
app.get("/report/:id", async (req, res) => {
  const { id } = req.params; // Extract roll number from the URL parameter
  console.log("Received roll number:", id); // Debug: Print received roll number

  if (!id) {
    return res.status(400).json({ message: "Roll number is required" });
  }

  try {
    // Fetch the student's name and exam report by joining "Student-info" and "Student_Marks"
    const result = await db.execute(
      `SELECT si.rollNumber, si.firstName, si.lastName, sm.subject, sm.marks, sm.grade, sm.typeofexam
       FROM "Student-info" si
       JOIN "Student_Marks" sm ON si.rollNumber = sm.rollNumber
       WHERE si.rollNumber = ?`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: `No exam reports found for roll number ${id}` });
    }

    console.log("Fetched data:", result.rows); // Add this line to debug

    // Send the result as a response, including the student's name and marks
    res.status(200).json(result.rows);
  } catch (error) {
    console.error(`Error fetching exam report for roll number ${id}:`, error);
    res.status(500).send("Failed to retrieve the exam report");
  }
});

// Add Exam Report
app.post("/addexamreport", async (req, res) => {
  const { rollNumber, examData } = req.body;  // examData is an array of subjects and their details

  console.log("Received roll number:", rollNumber); // Debug: Print received roll number

  if (!rollNumber || !examData || !Array.isArray(examData)) {
    return res.status(400).json({ error: 'Invalid input. Please provide rollNumber and examData array' });
  }

  try {
    // Loop through each subject's exam data and insert or update the records into the database
    for (let i = 0; i < examData.length; i++) {
      const { subject, marks, grade, typeofexam } = examData[i];

      // Ensure that all required fields are provided
      if (!subject || !marks || !grade || !typeofexam) {
        return res.status(400).json({ error: 'Missing required fields in exam data' });
      }

      // Check if the record already exists
      const existingRecord = await db.execute(
        "SELECT * FROM `Student_Marks` WHERE `rollNumber` = ? AND `subject` = ? AND `typeofexam` = ?",
        [rollNumber, subject, typeofexam]
      );

      if (existingRecord.rows.length > 0) {
        // Update the existing record
        await db.execute(
          "UPDATE `Student_Marks` SET `marks` = ?, `grade` = ? WHERE `rollNumber` = ? AND `subject` = ? AND `typeofexam` = ?",
          [marks, grade, rollNumber, subject, typeofexam]
        );
      } else {
        // Insert the new record
        await db.execute(
          "INSERT INTO `Student_Marks` (`rollNumber`, `subject`, `marks`, `grade`, `typeofexam`) VALUES (?, ?, ?, ?, ?)",
          [rollNumber, subject, marks, grade, typeofexam]
        );
      }
    }

    res.status(201).json({ message: 'Exam report(s) added/updated successfully' });
  } catch (error) {
    console.error("Error adding/updating exam report(s):", error);
    res.status(500).send("Failed to add/update exam report(s)");
  }
});

// Deleting
app.delete("/deletegrade/:grade", async (req, res) => {
  const { grade } = req.params;
  try {
    const result = await db.execute("DELETE FROM `Student_Marks` WHERE `grade` = ?", [grade]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: `No data found for grade ${grade}` });
    }
    res.status(200).json({ message: `Data for grade ${grade} deleted successfully` });
  } catch (error) {
    console.error(`Error deleting data for grade ${grade}:`, error);
    res.status(500).send("Failed to delete the grade data");
  }
});


// Marks code End From Here


// Route to get the list of classes
app.get("/api/timetables/classes", (req, res) => {
  const classes = ["LKG", "UKG", "Class1", "Class2", "Class3", "Class4", "Class5", "Class6", "Class7", "Class8", "Class9", "Class10"];
  res.json(classes);
});

// Route to upload general timetable for a specific class
app.post("/api/timetables/upload/:class", upload.single("file"), (req, res) => {
  const className = req.params.class;
  if (!req.file) {
    return res.status(400).send("No file uploaded.");
  }

  const uploadNewFile = () => {
    const folderName = `Class_Timetables/${className}`;
    uploadFile(
      req.file.buffer,
      req.file.originalname,
      folderName,
      (result) => {
        generalTimetableFiles[className] = result.fileId;
        res.send(result);
      },
      (error) => {
        console.error("Error uploading file:", error);
        res.status(500).send(error);
      }
    );
  };

  if (generalTimetableFiles[className]) {
    deleteFile(
      generalTimetableFiles[className],
      () => uploadNewFile(),
      (error) => {
        console.error("Error deleting old file:", error);
        res.status(500).send(error);
      }
    );
  } else {
    uploadNewFile();
  }
});

// Route to delete general timetable for a specific class
app.delete("/api/timetables/delete/:class", (req, res) => {
  const className = req.params.class;
  if (!generalTimetableFiles[className]) {
    return res.status(400).send("No file to delete.");
  }

  deleteFile(
    generalTimetableFiles[className],
    () => {
      delete generalTimetableFiles[className];
      res.send({ message: "File deleted successfully" });
    },
    (error) => {
      console.error("Error deleting file:", error);
      res.status(500).send(error);
    }
  );
});

// Route to get the list of PDFs for a specific class' general timetable
app.get("/api/timetables/view/:class", (req, res) => {
  const className = req.params.class;
  const folderName = `Class_Timetables/${className}`;

  imagekit.listFiles({
    path: folderName,
    fileType: 'all',
  }, (error, result) => {
    if (error) {
      console.error('Error fetching file list:', error);
      return res.status(500).send(error);
    }

    // Map the result to only include the necessary information
    const pdfFiles = result.map(file => ({
      fileName: file.name,
      url: file.url,
      fileId: file.fileId
    }));

    res.json(pdfFiles);
  });
});

// Route to upload exam timetable for a specific class
app.post("/api/exam-timetables/upload/:class", upload.single("file"), (req, res) => {
  const className = req.params.class;
  if (!req.file) {
    return res.status(400).send("No file uploaded.");
  }

  const uploadNewFile = () => {
    const folderName = `Exam_Timetables/${className}`;
    uploadFile(
      req.file.buffer,
      req.file.originalname,
      folderName,
      (result) => {
        examTimetableFiles[className] = result.fileId;
        res.send({ url: result.url });
      },
      (error) => {
        console.error("Error uploading file:", error);
        res.status(500).send(error);
      }
    );
  };
      
      if (examTimetableFiles[className]) {
        deleteFile(
          examTimetableFiles[className],
          () => uploadNewFile(),
          (error) => {
            console.error("Error deleting old file:", error);
            res.status(500).send(error);
          }
        );
      } else {
        uploadNewFile();
      }
      });
      
      // Route to delete exam timetable for a specific class
      app.delete("/api/exam-timetables/delete/:class", (req, res) => {
        const className = req.params.class;
        if (!examTimetableFiles[className]) {
          return res.status(400).send("No file to delete.");
        }
      
        deleteFile(
          examTimetableFiles[className],
          () => {
            delete examTimetableFiles[className];
            res.send({ message: "File deleted successfully" });
          },
          (error) => {
            console.error("Error deleting file:", error);
            res.status(500).send(error);
          }
        );
      });
      
      // Route to get the list of PDFs for a specific class' exam timetable
      app.get("/api/exam-timetables/view/:class", (req, res) => {
        const className = req.params.class;
        const folderName = `Exam_Timetables/${className}`;
      
        imagekit.listFiles({
          path: folderName,
          fileType: 'all',
        }, (error, result) => {
          if (error) {
            console.error('Error fetching file list:', error);
            return res.status(500).send(error);
          }
      
          // Map the result to only include the necessary information
          const pdfFiles = result.map(file => ({
            fileName: file.name,
            url: file.url,
            fileId: file.fileId
          }));
      
          res.json(pdfFiles);
        });
      });
      
      // Attendance routes
      const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
      const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
      
      const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
      });
      const sheets = google.sheets({ version: "v4", auth });

// Endpoint to save attendance
app.post("/save", validateRequestBody(["Class", "RollNumber", "NameOfTheStudent", "ParentEmail", "Section"]), async (req, res) => {
  try {
    const { Class, RollNumber, NameOfTheStudent, ParentEmail, Section } = req.body;
    const rows = [[RollNumber, NameOfTheStudent, ParentEmail, Section]];

    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${Class}!A2:D2`,
      valueInputOption: "RAW",
      resource: { values: rows },
    });

    res.status(200).send({ message: "Data saved successfully!" });
  } catch (error) {
    console.error("Error saving data:", error.message);
    res.status(500).send({ error: "Failed to save data" });
  }
});

// Endpoint: Get today's attendance summary
app.get("/attendance/current/:classSheet", async (req, res) => {
  const { classSheet } = req.params;

  try {
    const currentDate = getISTDate();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${classSheet}!A1:Z`,
    });

    const data = response.data.values || [];
    const headers = data[0];
    const rows = data.slice(1);

    const dateIndex = headers.indexOf(currentDate);
    if (dateIndex === -1) {
      return res.status(400).json({ error: "No attendance marked for today." });
    }

    const todaySummary = rows.map((row) => ({
      rollNumber: row[0],
      studentName: row[1],
      status: row[dateIndex],
    }));

    res.json({ success: true, todaySummary });
  } catch (error) {
    console.error("Error fetching today's attendance:", error.message);
    res.status(500).json({ error: "Failed to fetch today's attendance" });
  }
});

// Endpoint: Get users
app.get("/getUsers", async (req, res) => {
  try {
    const getResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: "User!A2:B",
    });

    res.status(200).send(getResponse.data.values);
  } catch (error) {
    console.error("Error fetching user data:", error.message);
    res.status(500).send({ error: "Failed to fetch user data" });
  }
});

// Endpoint: Update user info with validation
app.post("/updateUser", validateRequestBody(["CurrentUsername", "NewUsername", "CurrentPassword", "NewPassword"]), async (req, res) => {
  try {
    const { CurrentUsername, NewUsername, CurrentPassword, NewPassword } = req.body;

    const getResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
                range: "User!A2:B",
            });

            const rows = getResponse.data.values || [];
            const updatedRows = rows.map((row) =>
                row[0] === CurrentUsername && row[1] === CurrentPassword
                    ? [NewUsername, NewPassword]
                    : row
            );

            await sheets.spreadsheets.values.clear({
                spreadsheetId: SPREADSHEET_ID,
                range: "User!A2:B",
            });

            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: "User!A2",
                valueInputOption: "RAW",
                resource: { values: updatedRows },
            });

            res.status(200).send({ message: "User info updated successfully!" });
        } catch (error) {
            console.error("Error updating user info:", error.message);
            res.status(500).send({ error: "Failed to update user info" });
        }
    }
);

// Endpoint: Attendance Tracker
app.post("/attendance/tracker", async (req, res) => {
    const { classSheet } = req.body;

    if (!classSheet) {
        return res.status(400).json({ error: "Missing required field: classSheet" });
    }

    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${classSheet}!A1:Z`,
        });

        const data = response.data.values || [];
        const headers = data[0];
        const rows = data.slice(1);

        const tracker = rows.map((row) => {
            const rollNumber = row[0];
            const studentName = row[1];
            const section = row[3];
            const attendanceStatuses = row.slice(4);
            const totalPresent = attendanceStatuses.filter((status) => status === "Present").length;
            const totalAbsent = attendanceStatuses.filter((status) => status === "Absent").length;
            const totalDays = totalPresent + totalAbsent;
            const attendancePercentage = totalDays > 0 ? ((totalPresent / totalDays) * 100).toFixed(2) : 0;

            return {
                rollNumber,
                studentName,
                section,
                totalPresent,
                totalAbsent,
                attendancePercentage,
            };
        });

        const totalStudents = tracker.length;
        const totalPresent = tracker.reduce((sum, student) => sum + student.totalPresent, 0);
        const totalAbsent = tracker.reduce((sum, student) => sum + student.totalAbsent, 0);

        const summary = {
            totalStudents,
            totalPresent,
            totalAbsent,
        };

        res.json({ success: true, tracker, summary });
    } catch (error) {
        console.error("Error fetching attendance tracker:", error.message);
        res.status(500).json({ error: "Failed to fetch attendance tracker" });
    }
});

// New Endpoints for modifying and deleting student information

// Endpoint: Search student
app.post("/search-student", validateRequestBody(["Class", "RollNumber"]), async (req, res) => {
    const { Class, RollNumber } = req.body;

    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${Class}!A2:Z`,
        });

        const rows = response.data.values || [];
        const studentRow = rows.find((row) => row[0] === RollNumber);

        if (!studentRow) {
            return res.status(404).json({ error: "Student not found." });
        }

        const studentData = {
            RollNumber: studentRow[0],
            NameOfTheStudent: studentRow[1],
            ParentEmail: studentRow[2],
            Section: studentRow[3],
        };

        res.json(studentData);
    } catch (error) {
        console.error("Error searching for student:", error.message);
        res.status(500).json({ error: "Failed to search for student" });
    }
});

// Endpoint: Update student
app.post("/update-student", validateRequestBody(["Class", "RollNumber", "NameOfTheStudent", "ParentEmail", "Section"]), async (req, res) => {
    const { Class, RollNumber, NameOfTheStudent, ParentEmail, Section } = req.body;

    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${Class}!A2:D`, // Ensure the range includes only valid data columns
        });

        const rows = response.data.values || [];
        const rowIndex = rows.findIndex((row) => row[0]?.trim() === RollNumber.trim());

        if (rowIndex === -1) {
            return res.status(404).json({ error: "Student not found." });
        }

        rows[rowIndex] = [RollNumber.trim(), NameOfTheStudent.trim(), ParentEmail.trim(), Section.trim()];

        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `${Class}!A2`, // Always start from A2
            valueInputOption: "RAW",
            resource: { values: rows },
        });

        res.status(200).send({ message: "Student information updated successfully!" });
    } catch (error) {
        console.error("Error updating student data:", error.message);
        res.status(500).send({ error: "Failed to update student data" });
    }
});



// Endpoint: Get full attendance sheet
app.get("/attendance/full/:classSheet", async (req, res) => {
    const { classSheet } = req.params;
  
    try {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${classSheet}!A1:Z`,
      });
  
      const data = response.data.values || [];
      const headers = data[0];
      const rows = data.slice(1);
  
      const attendanceData = rows.map((row) => ({
        rollNumber: row[0],
        studentName: row[1],
        dates: headers.slice(4), // Assuming that dates start from the 4th column
        statuses: row.slice(4)
      }));
  
      res.json({ success: true, attendanceData });
    } catch (error) {
      console.error("Error fetching full attendance sheet:", error.message);
      res.status(500).json({ error: "Failed to fetch full attendance sheet" });
    }
  });
  
  // Endpoint: Delete full attendance sheet
  app.delete("/attendance/full/:classSheet", async (req, res) => {
    const { classSheet } = req.params;
  
    try {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        resource: {
          requests: [
            {
              deleteSheet: {
                sheetId: (await getSheetId(classSheet))
              }
            }
          ]
        }
      });
  
      res.json({ success: true, message: `Attendance sheet for ${classSheet} deleted successfully.` });
    } catch (error) {
      console.error("Error deleting full attendance sheet:", error.message);
      res.status(500).json({ error: "Failed to delete full attendance sheet" });
    }
  });
  
  async function getSheetId(sheetTitle) {
    const sheetInfo = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID,
    });
  
    const sheet = sheetInfo.data.sheets.find(sheet => sheet.properties.title === sheetTitle);
    return sheet ? sheet.properties.sheetId : null;
  }


 // Endpoint: Create a new sheet
app.post("/sheet/create", async (req, res) => {
    const { sheetName } = req.body;
  
    try {
      const response = await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        resource: {
          requests: [
            {
              addSheet: {
                properties: {
                  title: sheetName
                }
              }
            }
          ]
        }
      });
  
      res.json({ success: true, message: `Sheet "${sheetName}" created successfully.` });
    } catch (error) {
      console.error("Error creating sheet:", error.message);
      res.status(500).json({ error: "Failed to create sheet" });
    }
  });


  // Endpoint
// Fetch fee status counts
app.get('/feestatuscount', async (req, res) => {
  try {
      // Replace with your actual query to count fee statuses
      const result = await db.execute({
          sql: `SELECT
                  SUM(CASE WHEN feeStatus = 'PAID' THEN 1 ELSE 0 END) AS paid,
                  SUM(CASE WHEN feeStatus = 'UNPAID' THEN 1 ELSE 0 END) AS unpaid,
                  SUM(CASE WHEN feeStatus = 'PARTIALLY PAID' THEN 1 ELSE 0 END) AS partiallyPaid
                FROM "Student-info"`,
          args: [],
      });

      const counts = result.rows[0];
      res.status(200).json(counts);
  } catch (error) {
      console.error('Error fetching fee status counts:', error);
      res.status(500).send({ error: 'Failed to retrieve fee status counts' });
  }
});



  // Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
