const re = /\b(6509\d{11})\b/g;
const m = re.exec('650911429558113');
console.log('m:', m);
console.log('m[1]:', m && m[1]);
console.log('m.length:', m && m.length);
