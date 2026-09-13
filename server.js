const http = require('http');
const fs = require('fs');
const path = require('path');

const port = 8123;
const host = '0.0.0.0';

const rootPath = path.join(__dirname, 'files');

// Extensions whose files carry their own embedded application/software icon
const SOFTWARE_EXTENSIONS = ['exe', 'msi', 'msix', 'appx', 'com', 'scr', 'cpl'];

// pe-library/resedit/icojs are ESM-only; load them lazily via dynamic import from this CJS file
let iconModulesPromise = null;
function loadIconModules() {
	if (!iconModulesPromise) {
		iconModulesPromise = Promise.all([import('pe-library'), import('resedit'), import('icojs')]);
	}
	return iconModulesPromise;
}

// Extracts the icon embedded in a Windows PE executable's resource section, as a PNG buffer.
// Pure JS, so it works regardless of the OS the server runs on. Naturally fails (and the caller
// falls back to the generic file icon) for non-PE files, or files without an icon resource.
async function extractFileIcon(filePath) {
	const [{ NtExecutable, NtExecutableResource }, { Resource, Data }, { decodeIco }] = await loadIconModules();

	const fileData = fs.readFileSync(filePath);
	const exe = NtExecutable.from(fileData, { ignoreCert: true });
	const res = NtExecutableResource.from(exe);

	const groups = Resource.IconGroupEntry.fromEntries(res.entries);
	if (groups.length === 0) throw new Error('No icon resource in file');

	const group = groups[0];
	const items = group.getIconItemsFromEntries(res.entries);

	const iconFile = new Data.IconFile();
	iconFile.icons = group.icons.map((meta, i) => ({
		width: meta.width,
		height: meta.height,
		colors: meta.colors,
		planes: meta.planes,
		bitCount: meta.bitCount,
		data: items[i],
	}));

	const images = await decodeIco(iconFile.generate(), 'image/png');
	images.sort((a, b) => b.width - a.width);
	return Buffer.from(images[0].buffer);
}

if (!fs.existsSync(rootPath)) {
	fs.mkdirSync(rootPath);
	fs.writeFileSync(path.join(rootPath, 'hello.txt'), 'Server is active!');
}

const server = http.createServer((req, res) => {
	const parsedUrl = new URL(req.url, `http://${host}:${port}`);
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

		let failed = false;
		const failUpload = (statusCode, message, err) => {
			if (failed) return;
			failed = true;
			if (err) console.error('Upload failed', err);
			fileStream.close(() => {
				fs.unlink(filePath, () => {
					if (!res.headersSent) {
						res.writeHead(statusCode, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
					}
					res.end(message);
				});
			});
		};

		req.on('error', (err) => failUpload(500, 'Upload failed: connection error', err));
		req.on('aborted', () => failUpload(400, 'Upload failed: connection aborted'));
		fileStream.on('error', (err) => failUpload(500, 'Upload failed: could not write file', err));

		req.pipe(fileStream);

		req.on('end', () => {
			if (failed) return;
			res.writeHead(200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
			res.end('Upload successful');
		});
		return;
	}

	// Handle Fetching Available/Total Disk Storage (API Endpoint)
	if (req.method === 'GET' && pathname === '/api/storage') {
		try {
			const stats = fs.statfsSync(rootPath);
			const total = stats.blocks * stats.bsize;
			const free = stats.bavail * stats.bsize;
			res.writeHead(200, { 'Content-Type': 'application/json' });
			return res.end(JSON.stringify({ total, free, used: total - free }));
		} catch (err) {
			console.error('Failed to read disk storage stats', err);
			res.writeHead(500, { 'Content-Type': 'application/json' });
			return res.end(JSON.stringify({ error: 'Failed to read disk storage stats' }));
		}
	}

	// Handle Fetching an Executable's Embedded App/Software Icon (API Endpoint)
	if (req.method === 'GET' && pathname === '/api/icon') {
		const fileName = parsedUrl.searchParams.get('file');
		if (!fileName) {
			res.writeHead(400, { 'Content-Type': 'text/plain' });
			return res.end('Missing file query parameter target');
		}

		const safeSuffix = path.normalize(fileName).replace(/^(\.\.(\/|\\|$))+/, '');
		const filePath = path.join(rootPath, safeSuffix);
		const ext = path.extname(filePath).slice(1).toLowerCase();

		if (!SOFTWARE_EXTENSIONS.includes(ext) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
			res.writeHead(404, { 'Content-Type': 'text/plain' });
			return res.end('Icon not available');
		}

		extractFileIcon(filePath)
			.then((pngBuffer) => {
				res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' });
				res.end(pngBuffer);
			})
			.catch((err) => {
				console.error('Icon extraction failed', err);
				res.writeHead(404, { 'Content-Type': 'text/plain' });
				res.end('Icon not available');
			});
		return;
	}

	// Handle Fetching Current Files with Sizes (API Endpoint)
	if (req.method === 'GET' && pathname === '/api/files') {
		const fileNames = fs.existsSync(rootPath) ? fs.readdirSync(rootPath) : [];

		const filesWithMetadata = fileNames.map((name) => {
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
	if (req.method === 'GET' || req.method === 'HEAD') {
		if (pathname === '/' || pathname === '/index.html') {
			const htmlPath = path.join(__dirname, 'index.html');
			if (fs.existsSync(htmlPath)) {
				res.writeHead(200, { 'Content-Type': 'text/html' });
				if (req.method === 'HEAD') return res.end();
				return fs.createReadStream(htmlPath).pipe(res);
			}
		}

		// Safely deliver the style.css stylesheet asset map directly from root directory folder
		if (pathname === '/style.css') {
			const cssPath = path.join(__dirname, 'style.css');
			if (fs.existsSync(cssPath)) {
				res.writeHead(200, { 'Content-Type': 'text/css' });
				if (req.method === 'HEAD') return res.end();
				return fs.createReadStream(cssPath).pipe(res);
			}
		}

		const safeSuffix = path.normalize(decodeURIComponent(pathname)).replace(/^(\.\.(\/|\\|$))+/, '');
		const filePath = path.join(rootPath, safeSuffix);

		if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
			const fileSize = fs.statSync(filePath).size;
			const range = req.headers.range;

			res.setHeader('Accept-Ranges', 'bytes');
			res.setHeader(
				'Content-Disposition',
				`attachment; filename="${encodeURIComponent(path.basename(filePath))}"`,
			);

			if (req.method === 'HEAD') {
				res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': fileSize });
				return res.end();
			}

			// Honor Range requests so large downloads can resume after a dropped/reset connection
			if (range) {
				const match = /^bytes=(\d*)-(\d*)$/.exec(range);
				const start = match && match[1] ? parseInt(match[1], 10) : 0;
				const end = match && match[2] ? parseInt(match[2], 10) : fileSize - 1;

				if (!match || start > end || end >= fileSize) {
					res.writeHead(416, { 'Content-Range': `bytes */${fileSize}` });
					return res.end();
				}

				res.writeHead(206, {
					'Content-Type': 'application/octet-stream',
					'Content-Range': `bytes ${start}-${end}/${fileSize}`,
					'Content-Length': end - start + 1,
				});
				const partialStream = fs.createReadStream(filePath, { start, end });
				partialStream.on('error', (err) => {
					console.error('Download stream error', err);
					res.destroy(err);
				});
				return partialStream.pipe(res);
			}

			res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': fileSize });
			const fileStream = fs.createReadStream(filePath);
			fileStream.on('error', (err) => {
				console.error('Download stream error', err);
				res.destroy(err);
			});
			return fileStream.pipe(res);
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

// Ensure the listening socket is actually released on Ctrl+C / window close,
// instead of leaving node.exe orphaned in the background still holding the port
function shutdown() {
	console.log('Shutting down, releasing port...');
	server.close(() => process.exit(0));
	server.closeAllConnections?.();
	setTimeout(() => process.exit(0), 2000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGHUP', shutdown);
process.on('SIGBREAK', shutdown);

if (process.platform === 'win32') {
	require('readline')
		.createInterface({ input: process.stdin, output: process.stdout })
		.on('SIGINT', () => process.emit('SIGINT'));
}
