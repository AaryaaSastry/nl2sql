import { excelService } from '../excelService.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function createLargeDummyExcel() {
  const planTypes = ["Basic", "Premium", "Unlimited", "Unlimited Plus", "Family Share"];
  const cities = ["Mumbai", "Delhi", "Bangalore", "Hyderabad", "Chennai", "Kolkata", "Pune", "Ahmedabad"];
  const firstNames = ["Aarya", "Rahul", "Sneha", "Vikram", "Ananya", "Arjun", "Priya", "Karan", "Ishita", "Siddharth"];
  const lastNames = ["Sastry", "Verma", "Reddy", "Singh", "Iyer", "Kapoor", "Sharma", "Malhotra", "Goel", "Joshi"];

  const data = [];
  
  for (let i = 1; i <= 30; i++) {
    const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
    const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];
    const plan = planTypes[Math.floor(Math.random() * planTypes.length)];
    const city = cities[Math.floor(Math.random() * cities.length)];
    
    // Generate random date between 2020 and 2024
    const start = new Date(2020, 0, 1);
    const end = new Date(2024, 4, 1);
    const joinDate = new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime())).toISOString().split('T')[0];

    data.push({
      "Customer ID": `TEL-${1000 + i}`,
      "Name": `${firstName} ${lastName}`,
      "Email": `${firstName.toLowerCase()}.${lastName.toLowerCase()}${i}@example.com`,
      "City": city,
      "Join Date": joinDate,
      "Plan": plan,
      "Data Usage (GB)": parseFloat((Math.random() * 150).toFixed(2)),
      "Monthly Bill": Math.floor(Math.random() * 4000) + 200,
      "Is Active": Math.random() > 0.1,
      "Last Payment Status": Math.random() > 0.2 ? "Paid" : "Overdue"
    });
  }

  const filePath = path.join(__dirname, 'telecom_customers_30.xlsx');
  
  try {
    await excelService.writeExcel(filePath, data, 'CustomerMaster');
    console.log(`Successfully created expanded dummy Excel file at: ${filePath}`);
    
    // Read back a summary
    const result = await excelService.readExcel(filePath);
    console.log('\n--- Verification ---');
    console.log(`Total Records: ${result.rowCount}`);
    console.log(`Columns: ${Object.keys(result.data[0]).join(", ")}`);
    console.log('\nFirst 3 entries:');
    console.table(result.data.slice(0, 3));
  } catch (error) {
    console.error('Error:', error.message);
  }
}

createLargeDummyExcel();
