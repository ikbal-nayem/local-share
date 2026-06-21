# Local Share

Local Share is a lightweight, browser-based file sharing web app built with Node.js. It serves a simple UI for uploading, listing, downloading, and deleting files from a local `files/` folder.

## Features

- Upload files directly from the browser
- Download files with a single click
- Search the available file list
- Delete files from server storage
- Automatically creates and maintains a local `files/` directory

## Requirements

- Node.js installed (Node 18+ recommended)

## Installation

```bash
cd /workspaces/local-share
npm install
```

> `package.json` currently includes a dependency entry, but the server only uses built-in Node modules for HTTP and file handling.

## Running the App

```bash
node server.js
```

Then open the app in your browser at:

- `http://localhost:8080`

The server will also print any local network addresses available on startup.

## Project Structure

- `server.js` - Node HTTP server handling file uploads, downloads, list metadata, and delete requests
- `index.html` - Browser UI for file upload, search, download, and delete actions
- `style.css` - UI styling
- `files/` - Local storage folder created automatically on first startup

## API Endpoints

- `POST /upload` - Upload a file with `X-File-Name` header set to the filename
- `GET /api/files` - Get JSON metadata for all stored files
- `DELETE /api/delete?file=<filename>` - Delete a named file from storage

## Notes

- Files are stored in the `files/` directory created by the app
- The server uses safe path normalization to prevent directory traversal attacks during delete and download operations

## License

This repository does not include a license file. Use and modify it freely for local and experimental purposes.
