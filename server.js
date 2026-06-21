const http = require('http');
const fs = require('fs');
const path = require('path');

const port = 8080;
const host = '0.0.0.0';

const rootPath = path.join(__dirname, 'files');

if (!fs.existsSync(rootPath)) {
    fs.mkdirSync(rootPath);
    fs.writeFileSync(path.join(rootPath, 'hello.txt'), 'Server is active!');
}

const server = http.createServer((req, res) => {
    const parsedUrl = new URL(req.url, 'http://localhost');
    const pathname = parsedUrl.pathname;

    // Handle File Upload
    if (req.method === 'POST' && pathname === '/upload') {
        const fileName = decodeURIComponent(req.headers['x-file-name']);
        if (!fileName) {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            return res.end('Missing file name');
        }

        const filePath = path.join(rootPath, fileName);
        const fileStream = fs.createWriteStream(filePath);
        req.pipe(fileStream);

        req.on('end', () => {
            res.writeHead(200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
            res.end('Upload successful');
        });
        return;
    }

    // Handle Fetching Current Files with Sizes (API Endpoint)
    if (req.method === 'GET' && pathname === '/api/files') {
        const fileNames = fs.existsSync(rootPath) ? fs.readdirSync(rootPath) : [];
        
        const filesWithMetadata = fileNames.map(name => {
            const filePath = path.join(rootPath, name);
            let size = 0;
            try {
                size = fs.statSync(filePath).size;
            } catch (err) {
                console.error(`Failed to read stats for ${name}`, err);
            }
            return { name, size };
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(filesWithMetadata));
    }

    if (req.method === 'DELETE' && pathname === '/api/delete') {
        const fileName = parsedUrl.searchParams.get('file');
        if (!fileName) {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            return res.end('Missing file query parameter target');
        }

        // Standardize suffix variations to prevent directory traversal directory bypass attacks
        const safeSuffix = path.normalize(fileName).replace(/^(\.\.(\/|\\|$))+/, '');
        const filePath = path.join(rootPath, safeSuffix);

        // Check if file exists before processing deletion
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            fs.unlink(filePath, (err) => {
                if (err) {
                    res.writeHead(500, { 'Content-Type': 'text/plain' });
                    return res.end('Failed to delete target file structural item');
                }
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                return res.end('File removed successfully');
            });
        } else {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            return res.end('Target local file resource was not found inside path storage mapping folder');
        }
        return;
    }

    // Serve Files for Download / Serve UI
    if (req.method === 'GET') {
        if (pathname === '/' || pathname === '/index.html') {
            const htmlPath = path.join(__dirname, 'index.html');
            if (fs.existsSync(htmlPath)) {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                return fs.createReadStream(htmlPath).pipe(res);
            }
        }
        
        // Safely deliver the style.css stylesheet asset map directly from root directory folder
        if (pathname === '/style.css') {
            const cssPath = path.join(__dirname, 'style.css');
            if (fs.existsSync(cssPath)) {
                res.writeHead(200, { 'Content-Type': 'text/css' });
                return fs.createReadStream(cssPath).pipe(res);
            }
        }

        const safeSuffix = path.normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, '');
        const filePath = path.join(rootPath, safeSuffix);

        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
            return fs.createReadStream(filePath).pipe(res);
        }
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
});

server.listen(port, host, () => {
    console.log(`Server running on port ${port}`);
    const os = require('os');
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                console.log(`Network Link: http://${iface.address}:${port}`);
            }
        }
    }
});
