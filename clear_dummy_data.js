require('dotenv').config();
const db = require('./config/db');

async function clearData() {
    try {
        console.log("Deleting all records from sos_alerts...");
        await db.query("DELETE FROM sos_alerts");
        
        console.log("Deleting all records from needs...");
        await db.query("DELETE FROM needs");
        
        console.log("Data cleared successfully.");
        process.exit(0);
    } catch (err) {
        console.error("Error clearing data:", err);
        process.exit(1);
    }
}

clearData();
