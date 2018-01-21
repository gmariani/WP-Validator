(function () {
	'use strict';

	const electron = require('electron');
	const BrowserWindow = electron.BrowserWindow;
	const app = electron.app;
	const Menu = electron.Menu;
	const path = require('path');
	const url = require('url');
	const pjson = require('./package.json');
	let win;

	app.on('ready', function() {
		// Set menu
		const template = [
			{
				label: 'File',
				submenu: [
					{
						label: 'Open Containing Folder',
						accelerator: 'Shift+CmdOrCtrl+H',
						click() {
							console.log('Oh, hi there!');
						}
					}
				]
			}
		];
		//Menu.setApplicationMenu(Menu.buildFromTemplate(template));
		
		// Crate window
		win = new BrowserWindow({ width: 700, height: 600, title: pjson.name.replace("-", " ") + ' - ' + pjson.version });
		win.setMenu(null);
		win.loadURL(url.format({
			pathname: path.join(__dirname, 'index.html'),
			protocol: 'file:',
			slashes: true
		}));

		// Open the DevTools
		//win.webContents.openDevTools();

		// Emitted when the window is closed
		win.on('closed', function() {
			win = null
		});
	});

	// Quit when all windows are closed
	app.on('window-all-closed', function() {
		// On macOS it is common for applications and their menu bar to stay active until the user quits explicitly with Cmd + Q
		if (process.platform !== 'darwin') app.quit();
	});

	app.on('activate', function() {
		// On macOS it's common to re-create a window in the app when the dock icon is clicked and there are no other windows open
		if (win === null) createWindow();
	});
})();