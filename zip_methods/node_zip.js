const fs = require('fs');
const archiver = require('archiver');

const output = fs.createWriteStream('output.zip');
const archive = archiver('zip');

output.on('close', function() {
    console.log(archive.pointer() + ' total bytes');
});

archive.pipe(output);
archive.directory('path/to/your/folder/', false);
archive.finalize();