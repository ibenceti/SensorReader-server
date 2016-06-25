var express = require('express');
var http = require('http');
var io = require('socket.io');
var path = require('path');

var riak = require('basho-riak-client');
var pg = require('pg');

var fs = require('fs');

var riak_hosts = ['127.0.0.1:8087'];
var riak_client = new riak.Client(riak_hosts);

var pgConnectionString = 'postgres://postgres:postgres@localhost:5432/device_data'
//var	pg_client = new pg.Client(pgConnectionString).connect();

var mobileDevices = {};
var mobileObservables = {};
var webApps = {};

var appWeb = express();
var appMob = express();
var httpWeb = http.Server(appWeb);
var httpMob = http.Server(appMob);
var ioWeb = io(httpWeb);
var ioMob = io(httpMob);

appWeb.use(express.static(path.join(__dirname, '/public')));
//httpWeb.maxConnections = 1;


appWeb.get('/', function(req, res){
	res.sendfile('index.html');
});

ioMob.on('connection', function(socket){
	
	//connected request details
	console.log('Mob user connected');
	socket.emit('request_registration');
	
	socket.on('new message', function(msg, ack){
		console.log('Mob new msg socket: : ' + socket.id);
		//ioWeb.emit("test", msg, socket.id);
		if (mobileObservables[socket.id] != null){
			mobileObservables[socket.id].notifyObservers("data", msg, socket.id);
			mobileObservables[socket.id].history.push(msg);

			while(mobileObservables[socket.id].history.length > 60){
				mobileObservables[socket.id].history.shift();
			}
			console.log('History len: ' + mobileObservables[socket.id].history.length);
		}
		ack();
	});
	
	
	socket.on('update_device_data', function(msg){
	
		if (socket.id in mobileDevices){
			delete mobileDevices[socket.id];
			mobileDevices[socket.id] = msg;
			mobileObservables[socket.id].history = [];
			mobileObservables[socket.id].observers = [];
			ioWeb.emit('devices_changed', mobileDevices);
		}
	});
	
	socket.on('register_device', function(msg, ack){
		
		checkAndSaveDevicePG(msg);
		
		var parsed = JSON.parse(msg);
		
		var Observable ={
	
			interval: 0
			,counter: 0
			,history: []
			,observers: []
			, lastId: -1
			,addObserver: function (observerId, observer){
				this.observers.push({
					callback: observer
					, id: observerId
				})
				return observerId
			}
			,removeObserver: function(id){
				for (var i = this.observers.length - 1; i >= 0; i--){
					this.observers[i]
					if (this.observers[i].id == id){
						this.observers.splice(i, 1)
						return true
					}
				}
				return false
			}
			, notifyObservers: function(type, message, socketId){
				for (var i = this.observers.length - 1; i >= 0; i--){
					this.observers[i].callback(type, message, socketId)
				}
			}
		}			

		if (parsed.hasOwnProperty('reconnection')){
			
			var hasReconnected = false;

			for (var device in mobileDevices){
				var parsedDevice = JSON.parse(mobileDevices[device]);

				if (parsedDevice.id == parsed.id){
					hasReconnected = true;
					
					//replace old socket.id in devices list
					console.log('Mobile devices before remove: ' + Object.keys(mobileDevices).length);
					delete mobileDevices[device];
					mobileDevices[socket.id] = msg;
					console.log('Mobile devices after remove: ' + Object.keys(mobileDevices).length);
					console.log('Mobile observables before remove: ' + Object.keys(mobileObservables).length);
					
					//replace old socket.id in observables list
					temp = mobileObservables[device];
					delete mobileObservables[device];
					mobileObservables[socket.id] = temp;
					console.log('Mobile observables after remove: ' + Object.keys(mobileObservables).length);			
					//ioWeb.emit('devices_changed');
					mobileObservables[socket.id].notifyObservers("reconnect" ,device, socket.id);	
					ack("old");

				}
			}
			
			if (!hasReconnected && !(socket.id in mobileDevices)){
				mobileObservables[socket.id] = Observable;
				mobileDevices[socket.id] = msg;
				ioWeb.emit('devices_changed', mobileDevices);
				ack("new");
			}
			
		} else if (!(socket.id in mobileDevices)){
			mobileObservables[socket.id] = Observable;
			mobileObservables[socket.id].history =[];
			mobileObservables[socket.id].observers = [];
			mobileDevices[socket.id] = msg;
			ioWeb.emit('devices_changed', mobileDevices);
			ack("new");
		}
		
		console.log('registered device: ' + msg);
		console.log('registered device socket: ' + socket.id);
		console.log('registered devices: ' + mobileDevices);
	});
	
	socket.on('disconnect', function(){
		
		console.log('Mob user disconnected: ' + socket.id);
		//mobileObservables[socket.id].observers = [];
		//mobileObservables[socket.id].history = [];
		delete mobileObservables[socket.id];
		console.log('Mob observable unregistered');
		console.log('Mob device length: ' + Object.keys(mobileObservables).length);
		delete mobileDevices[socket.id];
		console.log('Mob device unregistered.');
		console.log('Mob device length: ' + Object.keys(mobileDevices).length);
		ioWeb.emit('devices_changed', mobileDevices);
	});
	
});

ioWeb.on('connection', function(socket){
	console.log('Web user connected');
	
	socket.on('start_sending', function(socketId){
		console.log('Start sending:' + socketId);
		
		ioMob.sockets.connected[socketId].emit("start_sending", "test");
		
	});
	
	socket.on('stop_sending', function(msg){
		console.log('Stop sending:' + msg);
	});
	
	socket.on('request_devices', function(response){
		response(mobileDevices);
		console.log('DEVICES SENT');
	});
	
	socket.on('txt_dump', function(deviceSocketId){
		fs.writeFile('testFile.txt', mobileObservables[deviceSocketId].history, function(err){
			if (err){
				console.log('Error saving file.');
			} else {
				console.log('File saved.');
			}
			
		
		})
	});
	
	
	socket.on('db_query', function(query, responseCallback){
		
		var cb = function (err, rslt){
			if (rslt){
				console.log('Query success.');
				responseCallback(rslt);
			} else if (err)
				console.log('Query error.'  + err);
				responseCallback(err);
			}

		var q = new riak.Commands.TS.Query.Builder()
			.withQuery(query)
			.withCallback(cb)
			.build();
		riak_client.execute(q);
	});
	
	socket.on('db_dump', function(deviceSocketId){
	
		var rows = [];
		for (var i = 0; i < mobileObservables[deviceSocketId].history.length; i++){
			
			var parsed = JSON.parse(mobileObservables[deviceSocketId].history[i]);
			var resolution = parsed.resolution;
			var device_id = parsed.device_id;
			var sensor_data;
			var time = parsed.start_timestamp;
				
			var tempRow = [];
			sensor_data = "";
			time = time + i * resolution;
			for (var j = 0; j < parsed.data.length; j++){
				if (j == 0){
					sensor_data += parsed.data[j][i];
				} else {
					sensor_data += ', ' + parsed.data[j][i];
				}
			}
				
				tempRow.push(device_id);
				tempRow.push(time);
				tempRow.push(tag);
				tempRow.push(sensor_data);
				rows.push(tempRow);
		}
			
				var cb = function (err, rslt){
					if (rslt){
						mobileObservables[deviceSocketId].counter++;
						console.log('Dumped to db: ' + rows.length);
					}
					else if (err)
						console.log('Error saving to db.'  + err);
				}
			
				var add = new riak.Commands.TS.Store.Builder()
					.withTable('sensor_data_bucket')
					.withRows(rows)
					.withCallback(cb)
					.build();
				
				riak_client.execute(add);
	});
	
	socket.on('db_save_interval', function(deviceSocketId, interval){
		
		mobileObservables[deviceSocketId].interval = interval;
		mobileObservables[deviceSocketId].addObserver( 'riak', function (type ,msg, socketId){
			
			if (mobileObservables[deviceSocketId].interval ==  mobileObservables[deviceSocketId].counter){
				
				mobileObservables[deviceSocketId].removeObserver('riak');
				mobileObservables[deviceSocketId].interval = 0;
				mobileObservables[deviceSocketId].counter = 0;
			
			} else {
			
				var rows = [];
				console.log('JOSN to DB: ' + msg);
				var msgParsed = JSON.parse(msg);
				var device_id = msgParsed.device_id;
				var sensor_data;
				var time = msgParsed.start_timestamp;
			
				for (var i = 0; i < msgParsed.data[0].length; i++){
				
					var tempRow = [];
					sensor_data = "";
					time = time + i * resolution;
					for (var j = 0; j < msgParsed.data.length; j++){
						if (j == 0){
							sensor_data += msgParsed.data[j][i];
						} else {
							sensor_data += ', ' + msgParsed.data[j][i];
						}
					}
				
					tempRow.push(device_id);
					tempRow.push(time);
					tempRow.push(tag);
					tempRow.push(sensor_data);
					rows.push(tempRow);
				}
			
				console.log('Saving to db: ' + rows);
			
				var cb = function (err, rslt){
					if (rslt){
						mobileObservables[deviceSocketId].counter++;
						console.log('Saved to db: ' + mobileObservables[deviceSocketId].counter);
					}
					else if (err)
						console.log('Error saving to db.'  + err);
				}
			
				/*var columns = [
					{name: 'time', type: riak.Commands.TS.ColumnType.Timestamp},
					{name: 'device_id', type: riak.Commands.TS.ColumnType.Varchar},
					{name: 'device_name', type: riak.Commands.TS.ColumnType.Varchar},
					{name: 'sensor_name', type: riak.Commands.TS.ColumnType.Varchar},
					{name: 'sensor_data', type: riak.Commands.TS.ColumnType.Varchar}
				];*/
			
				var add = new riak.Commands.TS.Store.Builder()
					.withTable('sensor_data_bucket')
					//.withColumns(columns)
					.withRows(rows)
					.withCallback(cb)
					.build();
				
				riak_client.execute(add);
			
			}
		});
	});
	
	socket.on('db_save_continuous', function(deviceSocketId, tag){
	
		var device = JSON.parse(mobileDevices[deviceSocketId])
		console.log('Device: ' + mobileDevices[deviceSocketId]);
		insertMeasurementPG (device.id, tag, device.resolution, new Date().getTime(), device.sensor);
		
		mobileObservables[deviceSocketId].addObserver( 'DB_' + socket.id, function (type ,msg, socketId){

			var rows = [];
			console.log('JOSN to DB: ' + msg);
			var msgParsed = JSON.parse(msg);
			var resolution = msgParsed.resolution;
			var device_id = msgParsed.device_id;
			var sensor_data;
			var time = msgParsed.start_timestamp;
			
			for (var i = 0; i < msgParsed.data[0].length; i++){
				
				var tempRow = [];
				sensor_data = "";
				time = time + i * resolution;
				for (var j = 0; j < msgParsed.data.length; j++){
					if (j == 0){
						sensor_data += msgParsed.data[j][i];
					} else {
						sensor_data += ',' + msgParsed.data[j][i];
					}
				}
				
				tempRow.push(device_id);
				tempRow.push(tag);
				tempRow.push(time);
				tempRow.push(sensor_data);
				rows.push(tempRow);
			}
			
			console.log('Saving to db: ' + rows);
			
			var cb = function (err, rslt){
				if (rslt){
					mobileObservables[deviceSocketId].counter++;
					console.log('Saved to db: ' + mobileObservables[deviceSocketId].counter);
				}
				else if (err)
					console.log('Error saving to db.'  + err);
			}
			
				
			var add = new riak.Commands.TS.Store.Builder()
				.withTable('sensor_data_bucket')
				.withRows(rows)
				.withCallback(cb)
				.build();
				
			riak_client.execute(add);
		});
		
		if (mobileObservables[deviceSocketId].observers.length != 0){
			
			ioMob.sockets.connected[deviceSocketId].emit("start_sending");
			console.log('Observers length: ' + mobileObservables[deviceSocketId].observers.length );
		}
		
		console.log('Observer registered: DB_' + socket.id);
	});
	
	socket.on('db_stop_continuous', function(deviceSocketId){
		
		if (mobileObservables[deviceSocketId] != null){
			mobileObservables[deviceSocketId].removeObserver('DB_' + socket.id)
			console.log('Observer unregistered: DB_' + socket.id);
			console.log('Observers length: ' + mobileObservables[deviceSocketId].observers.length );

			if (mobileObservables[deviceSocketId].observers.length == 0){
				ioMob.sockets.connected[deviceSocketId].emit("stop_sending");
				mobileObservables[deviceSocketId].history = [];
				mobileObservables[deviceSocketId].counter = 0;
			}
		}
	});
	
	socket.on('request_db_tags', function(deviceId, callback){
		
		getMeasurementsForDevicePG (deviceId, function(results){
			callback(results); 
		});
	});
	
	socket.on('register_observer', function(observableSocket){
		mobileObservables[observableSocket].addObserver( socket.id, function (type, msg, socketId){
			if (type == "data"){
				socket.emit("test", msg, socketId);
			} else  if (type == "reconnect"){
				socket.emit("reconnect", msg, socketId);
			}
			
			//console.log('Msg sent to observer');
		});
		
		if (mobileObservables[observableSocket].observers.length != 0){
			
			ioMob.sockets.connected[observableSocket].emit("start_sending");
			console.log('Observers length: ' + mobileObservables[observableSocket].observers.length );
		}
		
		console.log('Observer registered: ' + observableSocket + "  " + mobileObservables[observableSocket]);
	});
	
	socket.on('unregister_observer', function(observableSocket){
		
		if (mobileObservables[observableSocket] != null){
			mobileObservables[observableSocket].removeObserver(socket.id)
			console.log('Observer unregistered: ' + observableSocket + "  " + mobileObservables[observableSocket]);
			console.log('Observers length: ' + mobileObservables[observableSocket].observers.length );

			if (mobileObservables[observableSocket].observers.length == 0){
				ioMob.sockets.connected[observableSocket].emit("stop_sending");
				mobileObservables[observableSocket].history = [];
			}
		}
	});
	
	socket.on('disconnect', function(){
		
		for (var obs in mobileObservables){
			mobileObservables[obs].removeObserver(socket.id);
			mobileObservables[obs].removeObserver('DB_' + socket.id);
			
			if (mobileObservables[obs].observers.length == 0){
				mobileObservables[obs].history = [];
				ioMob.sockets.connected[obs].emit("stop_sending");
			}
		}
		
		console.log('Web user disconnected');
	});
	
});

httpWeb.listen(3030, function(){
	console.log('Web listening on *:3030');
});

httpMob.listen(3000, function(){
	console.log('Mob listening on *:3000');
});

function checkAndSaveDevicePG( deviceData ){
	
	//check if device in table
	var parsedDevice = JSON.parse(deviceData);
	var deviceExists = false;
	pg.connect(pgConnectionString, function (err, client, done){
		if (err){
			console.log('Error fetching clinet from pool:' + err);
		}
		
		var query = client.query("SELECT * FROM devices WHERE device_id ='" + parsedDevice.id + "';");
		query.on('row', function(row){
			deviceExists = true;
		});
		
		query.on('end', function(){
			done();
				//if device not in table insert new row
			if (!deviceExists){
				pg.connect(pgConnectionString, function (err, client, done){
					if (err){
						console.log('Error fetching clinet from pool:' + err);
					}
		
					console.log("INSERT INTO devices(device_id, time_registered, device_name) VALUES ('"+ parsedDevice.id +"', '" + new Date().getTime() + "', '"+ parsedDevice.name + "')");
					var query = client.query("INSERT INTO devices(device_id, time_registered, device_name) VALUES ('"+ parsedDevice.id +"', '" + new Date().getTime() + "', '"+ parsedDevice.device + "')");
					query.on('row', function(row){
					});
		
					query.on('end', function(){
						done();
					});
				});	
			}
		});
	});
	
}

function getMeasurementsForDevicePG (deviceId, callback){

	var results = [];

	pg.connect(pgConnectionString, function (err, client, done){
		if (err){
			console.log('Error fetching clinet from pool:' + err);
		}
		
		var query = client.query("SELECT * FROM devices JOIN  measurements ON devices.device_id = measurements.device_id WHERE devices.device_id ='" + deviceId + "' GROUP BY devices.id, measurements.id, tag, time_start;");
		query.on('row', function(row){
			console.log('Result:' + JSON.stringify(row));
			results.push(JSON.stringify(row));
		});
		
		query.on('end', function(){
			done();
			callback(results);
		});
	});
}

function insertMeasurementPG (deviceId, tag, resolution, startTime, sensorName){

	pg.connect(pgConnectionString, function (err, client, done){
					if (err){
						console.log('Error fetching clinet from pool:' + err);
					}
					var query = client.query("INSERT INTO measurements(device_id, time_start, tag, resolution, sensor_name) VALUES ('"+ deviceId +"', '" + startTime + "', '"+ tag + "', '"+ resolution + "', '" + sensorName + "')");
					query.on('row', function(row){
					});
		
					query.on('end', function(){
						done();
					});
				});
	
}


