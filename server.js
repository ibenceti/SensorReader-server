var express = require('express');
var http = require('http');
var io = require('socket.io');
var path = require('path');

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
	//res.send('<h1>Hello world</h1>');
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
		}
		ack();
	});
	
	socket.on('register_device', function(msg){
		
		var parsed = JSON.parse(msg);

		if (parsed.hasOwnProperty('reconnection')){

			for (var device in mobileDevices){
				var parsedDevice = JSON.parse(mobileDevices[device]);

				if (parsedDevice.id == parsed.id){
					console.log('Mobile devices before remove: ' + mobileDevices[device]);
					var temp = mobileDevices[device];
					delete mobileDevices[device];
					mobileDevices[socket.id] = temp;
					console.log('Mobile devices after remove: ' + mobileDevices[socket.id]);
					console.log('Mobile observables before remove: ' + mobileObservables[device]);
					temp = mobileObservables[device];
					delete mobileObservables[device];
					mobileObservables[socket.id] = temp;
					console.log('Mobile observables after remove: ' + mobileObservables[socket.id]);
					mobileObservables[socket.id].notifyObservers("reconnect" ,device, socket.id);

				}
			}
		} else if (!(socket.id in mobileDevices)){
			mobileObservables[socket.id] = Observable;
			mobileDevices[socket.id] = msg;
		}
		
		console.log('registered device: ' + msg);
		console.log('registered device socket: ' + socket.id);
		
		console.log('registered device: ' + parsed.type + parsed.resolution + parsed.sensor);
		console.log('registered devices: ' + mobileDevices);
	});
	
	socket.on('disconnect', function(){
		
		console.log('Mob user disconnected: ' + socket.id);
		delete mobileObservables[socket.id];
		console.log('Mob observable unregistered');
		console.log('Mob device length: ' + Object.keys(mobileObservables).length);
		delete mobileDevices[socket.id];
		console.log('Mob device unregistered.');
		console.log('Mob device length: ' + Object.keys(mobileDevices).length);
		
		
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
			console.log('Observables length: ' + mobileObservables[observableSocket].observers.length );
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
			}
		}
		
		
	});
	
	socket.on('disconnect', function(){
		
		for (var obs in mobileObservables){
			mobileObservables[obs].removeObserver(socket.id);
			
			if (mobileObservables[obs].observers.length == 0){
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

var Observable ={
	
	observers: []
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
