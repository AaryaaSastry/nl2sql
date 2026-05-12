import * as XLSX from 'xlsx';
const { readFile, writeFile, utils } = XLSX;
import fs from 'fs';
import { logger } from './errors.js';

/**
 * Service to handle Excel file operations
 */
export const excelService = {
  /**
   * Reads an Excel file and returns its content as JSON
   * @param {string} filePath - Path to the Excel file
   * @param {string} sheetName - Optional name of the sheet to read
   * @returns {Object} - Content of the Excel file
   */
  readExcel: async (filePath, sheetName = null) => {
    try {
      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }

      const workbook = XLSX.read(fs.readFileSync(filePath));
      const sheetNames = workbook.SheetNames;

      if (sheetNames.length === 0) {
        throw new Error('The Excel file has no sheets.');
      }

      // If sheetName is provided, find it; otherwise, use the first sheet
      const targetSheetName = sheetName || sheetNames[0];
      const worksheet = workbook.Sheets[targetSheetName];

      if (!worksheet) {
        throw new Error(`Sheet "${targetSheetName}" not found. Available sheets: ${sheetNames.join(', ')}`);
      }

      const data = XLSX.utils.sheet_to_json(worksheet);

      return {
        sheetName: targetSheetName,
        availableSheets: sheetNames,
        rowCount: data.length,
        data: data
      };
    } catch (error) {
      logger.error('Error reading Excel file', { filePath, error: error.message });
      throw error;
    }
  },

  /**
   * Lists all sheets in an Excel file
   * @param {string} filePath - Path to the Excel file
   * @returns {string[]} - Array of sheet names
   */
  listSheets: async (filePath) => {
    try {
      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }

      const workbook = XLSX.read(fs.readFileSync(filePath), { bookProps: true, bookSheets: true });
      return workbook.SheetNames;
    } catch (error) {
      logger.error('Error listing Excel sheets', { filePath, error: error.message });
      throw error;
    }
  },

  /**
   * Writes data to an Excel file
   * @param {string} filePath - Path where the Excel file will be saved
   * @param {Array<Object>} data - Data to write
   * @param {string} sheetName - Name of the sheet
   * @returns {string} - Path to the saved file
   */
  writeExcel: async (filePath, data, sheetName = 'Sheet1') => {
    try {
      const worksheet = XLSX.utils.json_to_sheet(data);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
      
      XLSX.writeFile(workbook, filePath);
      return filePath;
    } catch (error) {
      logger.error('Error writing Excel file', { filePath, error: error.message });
      throw error;
    }
  }
};
