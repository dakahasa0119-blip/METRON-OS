const fs = require('fs');
const content = fs.readFileSync('gateway/ARC_Gateway_doPost.js', 'utf8');
if (content.includes('const parseBakuStructuredReport = (text) => {') && content.includes('const parseCommandTags = (text) => {')) {
  console.log('Functions exist in the file');
} else {
  console.log('Functions DO NOT exist in the file');
}
