$(function() {
	
	const electron = require('electron');
	const path = require('path');
	const url = require('url');
	const fs = require('fs');
	const https = require('https');
	const unzip = require('unzip');
	const remote = electron.remote;
	const shell = electron.shell;
	const dialog = remote.dialog;
	
	let divMessages = $('#statusLog');
	let divErrors = $('#errorLog');
	let rootDir = null;
	let cleanDir = null;
	let arrFiles = [];
	let totalFiles = 0;
	let wpUnzipped = false;
	let hasMUPlugins = false;
	
	function deleteRecursive(strPath) {
		if ( fs.existsSync(strPath) ) {
			if ( !fs.lstatSync(strPath).isDirectory() ) {
				fs.unlinkSync(strPath);
			} else {
				fs.readdirSync(strPath).forEach(function( file, index ) {
					var curPath = path.join(strPath, file);
					if ( fs.lstatSync(curPath).isDirectory() ) { // recurse
						deleteRecursive(curPath);
					} else { // delete file
						fs.unlinkSync(curPath);
					};
				});
				fs.rmdirSync(strPath);
			};
		};
	};
	
	function setStatus( str ) {
		console.log(str);
		divMessages.html(str);
	}
	
	function setError( str ) {
		divErrors.addClass('show');
		console.error(str);
		divErrors.append('<p>' + str + '</p>');
	}
	
	function download(file, callBack) {
		let writer = fs.createWriteStream(file.savePath);
		let statusCode = null;
		
		setStatus('Downloading ' + path.basename(file.downloadURL) + '...');
		
		let request = https.get(file.downloadURL, function(response) {
			statusCode = response.statusCode;
			var len = parseInt(response.headers['content-length'], 10);
			var downloaded = 0;
			
			response.on( 'data', function(chunk) {
				downloaded += chunk.length;
				percent = (downloaded / len).toFixed(2);
				//console.log(percent);
				//setStatus(percent * 100 + '%');
				progress = totalFiles * progressIncrement + (percent * progressIncrement);
				progressButton._setProgress( progress );
			});
			
			response.pipe(writer);
		});
		request.on('close', function() {
			if (statusCode == 200) {
				if (callBack) {
					callBack(file.savePath);
				} else {
					console.error('download() callBack required');
				};
			} else {
				let msg = '(' + statusCode + ') Error downloading ' + file.type + ': <strong>' + file.name + ' - ' + file.version + '</strong>';
				if (file.devURL) msg += '<br><a href="' + file.devURL + '" target="_blank">' + file.devURL + '</a>';
				
				setError(msg);
				fs.unlink(file.savePath);
				downloadNext();
			};
		});
		request.on('error', function(err) {
			setError('Error downloading file: ' + err.message);
			fs.unlink(file.savePath);
			// if (callBack) callBack(err.message);
			downloadNext();
		});
	};
	
	function unzipDownload(destPath) {
		setStatus('Unzipping ' + path.basename(destPath));
		let curDir = path.resolve(destPath, '..');
		let reader = fs.createReadStream(destPath);
		let readerZip = reader.pipe(unzip.Extract({ path: curDir }));
		
		readerZip.on('close', function () {
			//console.log('Finished unzipping:', curDir);
			fs.unlink(destPath);
			unzipComplete(curDir);
			downloadNext();
		});
		readerZip.on('error', function() {
			setError('Error unzipping: ' + destPath);
			//fs.closeSync(); // TODO Close stream to failed file
			fs.unlink(destPath);
			unzipComplete(curDir);
			downloadNext();
		});
	};
	
	function unzipComplete(curDir) {
		if (!wpUnzipped) {
			setStatus('Remove bundled WordPress plugins/themes');
			wpUnzipped = true;
			
			// Create must-use plugins directory
			if ( hasMUPlugins ) {
				let muDir = path.join(curDir, 'wordpress', 'wp-content', 'mu-plugins');
				if ( !fs.existsSync(muDir) ) fs.mkdirSync(muDir);
			}
			
			// Delete plugins bundled with WP
			let dir = path.join(curDir, 'wordpress', 'wp-content', 'plugins');
			let arrChildren = fs.readdirSync(dir);
			for (let child of arrChildren) {
				if (child != 'index.php') deleteRecursive(path.join(dir, child));
			};
			
			// Delete themes bundled with WP
			dir = path.join(curDir, 'wordpress', 'wp-content', 'themes');
			arrChildren = fs.readdirSync(dir);
			for (let child of arrChildren) {
				if (child != 'index.php') deleteRecursive(path.join(dir, child));
			};
		};
	};
	
	function getWordPressVersion(rootDir) {
		let versionPath = path.join(rootDir, 'wp-includes', 'version.php');
		let versionRegex = /^\$wp_version = '([^\']+)';\s*$/gm;
		let data = fs.readFileSync(versionPath, 'utf-8');
		return versionRegex.exec(data)[1];
	};
	
	function getPluginData(slug, filePath, fileName) {
		if (path.extname(fileName).slice(1) == 'php') {
			let nameRegex = /^[\s\t\/*#@]*Plugin Name:\s*(.+)\s*$/gm;
			let uriRegex = /^[\s\t\/*#@]*Plugin URI:\s*(.+)\s*$/gm;
			let authorRegex = /^[\s\t\/*#@]*Author URI:\s*(.+)\s*$/gm;
			let versionRegex = /^[\s\t\/*#@]*Version:\s*(.+)\s*$/gm;
			let data = fs.readFileSync(filePath, 'utf-8');
			let result = nameRegex.exec(data);
			
			// Valid plugin
			if ( result != null ) {
				let pluginName = result[1];
				result = versionRegex.exec(data);
				let pluginVersion = result ? result[1] : '0.0.0';
				let zipURL = 'https://downloads.wordpress.org/plugin/' + slug + '.' + pluginVersion + '.zip';
				result = uriRegex.exec(data);
				let pluginURL = result ? result[1] : '';
				result = authorRegex.exec(data);
				let authorURL = result ? result[1] : '';
				return {'slug':path.basename(slug, '.php'), 'name':pluginName, 'version':pluginVersion, 'downloadURL':zipURL, 'devURL':pluginURL || authorURL};
			};
		};
		
		return null;
	};
	
	function getThemeData(slug, filePath) {
		let nameRegex = /^[\s\t\/*#@]*Theme Name:\s*(.+)\s*$/gm;
		let uriRegex = /^[\s\t\/*#@]*Theme URI:\s*(.+)\s*$/gm;
		let authorRegex = /^[\s\t\/*#@]*Author URI:\s*(.+)\s*$/gm;
		let versionRegex = /^[\s\t\/*#@]*Version:\s*(.+)\s*$/gm;
		let data = fs.readFileSync(filePath, 'utf-8');
		let result = nameRegex.exec(data);
		
		// Valid plugin
		if ( result != null ) {
			let themeName = result[1];
			result = versionRegex.exec(data);
			let themeVersion = result ? result[1] : '0.0.0';
			let zipURL = 'https://downloads.wordpress.org/theme/' + slug + '.' + themeVersion + '.zip';
			result = uriRegex.exec(data);
			let themeURL = result ? result[1] : '';
			result = authorRegex.exec(data);
			let authorURL = result ? result[1] : '';
			return {'slug':path.basename(slug, '.php'), 'name':themeName, 'version':themeVersion, 'downloadURL':zipURL, 'devURL':themeURL || authorURL};
		};

		return null;
	};
	
	function getPlugins(rootDir) {
		let pluginDir = path.join(rootDir, 'wp-content', 'plugins');
		if (!fs.existsSync(pluginDir)) return [];
		
		let arrRootChildren = fs.readdirSync(pluginDir);
		let arrPlugins = [];
		
		for (let rootChild of arrRootChildren) {
			let childPath = path.join(pluginDir, rootChild);
			
			// Is a plugin folder?
			if (fs.lstatSync(childPath).isDirectory()) {
				// Iterate files in folder
				let arrSubChildren = fs.readdirSync(childPath);
				for (let subChild of arrSubChildren) {
					let filePath = path.join(childPath, subChild);
					let result = getPluginData(rootChild, filePath, subChild);
					if ( result != null ) arrPlugins.push(result);
				};
				
			// Is a single file plugin?
			} else {
				let result = getPluginData(rootChild, childPath, rootChild);
				if ( result != null ) arrPlugins.push(result);
			};
		};
		
		return arrPlugins;
	};
	
	function getMUPlugins(rootDir) {
		let pluginDir = path.join(rootDir, 'wp-content', 'mu-plugins');
		if (!fs.existsSync(pluginDir)) return [];
		
		let arrRootChildren = fs.readdirSync(pluginDir);
		let arrPlugins = [];
		
		for (let rootChild of arrRootChildren) {
			let childPath = path.join(pluginDir, rootChild);
			
			// Is a plugin folder?
			if (fs.lstatSync(childPath).isDirectory()) {
				// Iterate files in folder
				let arrSubChildren = fs.readdirSync(childPath);
				for (let subChild of arrSubChildren) {
					let filePath = path.join(childPath, subChild);
					let result = getPluginData(rootChild, filePath, subChild);
					if ( result != null ) arrPlugins.push(result);
				};
				
			// Is a single file plugin?
			} else {
				let result = getPluginData(rootChild, childPath, rootChild);
				if ( result != null ) arrPlugins.push(result);
			};
		};
		
		return arrPlugins;
	};
	
	function getThemes(rootDir) {
		let themeDir = path.join(rootDir, 'wp-content', 'themes');
		if (!fs.existsSync(themeDir)) return [];
		
		let arrRootChildren = fs.readdirSync(themeDir);
		let arrThemes = [];
		
		for (let slug of arrRootChildren) {
			let childPath = path.join(themeDir, slug);
			
			// Is a theme folder?
			if (fs.lstatSync(childPath).isDirectory()) {
				let filePath = path.join(childPath, 'style.css');
				if (fs.existsSync(filePath)) {
					let themeData = getThemeData(slug, filePath);
					if (themeData) arrThemes.push( themeData );
				};
			};
		};
		
		return arrThemes;
	};
	
	function downloadNext() {
		if (arrFiles.length >= 1) {
			let file = arrFiles.shift();
			//console.log('Download Next: ' + file[0]);
			
			totalFiles++;
			progress = totalFiles * progressIncrement;
			progressButton._setProgress( progress );
			
			download(file, unzipDownload);
		} else {
			console.log('DONE');
			setStatus('');
			progressButton._stop(1);
		}
	};
	
	let progress = 0;
	let progressIncrement = 0;
	let progressButton = new ProgressButton( $('#btnStart')[0], {
		callback : function( instance ) {
			// nothing
		}
	});
	
	$('#btnStart').click(function() {
		dialog.showOpenDialog( {properties: ['openDirectory']}, function(directories) {
			if ( directories === undefined ) return;
			
			progressButton._start();
			
			// Reset messages
			setStatus('Scanning website...');
			divErrors.empty();
			divErrors.removeClass('show');
			wpUnzipped = false;
			hasMUPlugins = false;
			arrFiles = [];
			totalFiles = 0;
			progress =  0;
			progressButton._setProgress( progress );
			
			// Get source root directory
			rootDir = directories[0];
			rootName = path.basename(rootDir);
			console.log(rootName);
			cleanDir = path.resolve( rootDir, '..', rootName + '-clean' );
			if ( !fs.existsSync(cleanDir) ) fs.mkdirSync(cleanDir);
			
			// WordPress
			let wpVersion = getWordPressVersion(rootDir);
			console.log(path.join(cleanDir, 'wp.zip'));
			arrFiles.push({ 'name':'WordPress', 'type':'WordPress', 'version':wpVersion, 'downloadURL':'https://wordpress.org/wordpress-' + wpVersion + '.zip', 'savePath':path.join( cleanDir, 'wordpress-' + wpVersion + '.zip' ), 'devURL':'https://wordpress.org' });
			
			// Plugins
			let wpPlugins = getPlugins(rootDir);
			for (let plugin of wpPlugins) {
				console.log(path.join(cleanDir, 'wordpress', 'wp-content', 'plugins', plugin.slug + '.zip'));
				arrFiles.push({ 'name':plugin.name, 'type':'Plugin', 'version':plugin.version, 'downloadURL':plugin.downloadURL, 'savePath':path.join(cleanDir, 'wordpress', 'wp-content', 'plugins', plugin.slug + '.' + plugin.version + '.zip'), 'devURL':plugin.devURL });
			}
			
			// Must-Use Plugins
			let wpMUPlugins = getMUPlugins(rootDir);
			for (let plugin of wpMUPlugins) {
				hasMUPlugins = true;
				console.log(path.join(cleanDir, 'wordpress', 'wp-content', 'mu-plugins', plugin.slug + '.zip'));
				arrFiles.push({ 'name':plugin.name, 'type':'Must-Use Plugin', 'version':plugin.version, 'downloadURL':plugin.downloadURL, 'savePath':path.join(cleanDir, 'wordpress', 'wp-content', 'mu-plugins', plugin.slug + '.' + plugin.version + '.zip'), 'devURL':plugin.devURL });
			}
			
			// Themes
			let wpThemes = getThemes(rootDir);
			for ( let theme of wpThemes ) {
				console.log( path.join( cleanDir, 'wordpress', 'wp-content', 'themes', theme.slug + '.zip' ) );
				arrFiles.push({ 'name':theme.name, 'type':'Theme', 'version':theme.version, 'downloadURL':theme.downloadURL, 'savePath':path.join( cleanDir, 'wordpress', 'wp-content', 'themes', theme.slug + '.' + theme.version + '.zip'), 'devURL':theme.devURL });
			}
			console.log('-----------------------------------');
			
			progressIncrement = 0.9 * (1 / arrFiles.length);
			progress = 0.1;
			progressButton._setProgress( progress );
			
			// Start downloading files
			downloadNext();
		});
	});
	
	setStatus('');
	divErrors.empty();
	
	//open links externally by default
	$(document).on('click', 'a[href^="http"]', function(e) {
		e.preventDefault();
		shell.openExternal(this.href);
	});
});