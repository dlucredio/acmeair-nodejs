/*******************************************************************************
* Copyright (c) 2015 IBM Corp.
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*    http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*******************************************************************************/

import fs from 'fs';
import log4js from 'log4js';
import createRoutes from './authservice/routes/index.js';
import express from 'express';
import morgan from 'morgan';




var settings = JSON.parse(fs.readFileSync('settings.json', 'utf8'));
var logger = log4js.getLogger('authservice_app');
logger.level = settings.loggerLevel;

var port = (process.env.VMC_APP_PORT || process.env.VCAP_APP_PORT || settings.authservice_port);
var host = (process.env.VCAP_APP_HOST || 'localhost');

logger.info("host:port==" + host + ":" + port);

var dbtype = process.env.dbtype || "mongo";

//Calculate the backend datastore type if run inside BLuemix or cloud foundry
if (process.env.VCAP_SERVICES) {
    var env = JSON.parse(process.env.VCAP_SERVICES);
    logger.info("env: %j", env);
    var serviceKey = Object.keys(env)[0];
    if (serviceKey && serviceKey.indexOf('cloudant') > -1)
        dbtype = "cloudant";
    else if (serviceKey && serviceKey.indexOf('redis') > -1)
        dbtype = "redis";
}
logger.info("db type==" + dbtype);


var routes = new createRoutes(dbtype, settings);

// call the packages we need
var app = express();

if (settings.useDevLogger)
    app.use(morgan('dev'));                     		// log every request to the console

var router = express.Router();

router.post('/byuserid/:user', createToken);
router.get('/:tokenid', validateToken);
router.get('/status', checkStatus);
router.delete('/:tokenid', invalidateToken);

// REGISTER OUR ROUTES so that all of routes will have prefix 
app.use(settings.authContextRoot + '/authtoken', router);

var initialized = false;
var serverStarted = false;

initDB();

async function initDB() {
    if (initialized) return;
    try {
        await routes.initializeDatabaseConnections();
        initialized = true;
        logger.info("Initialized database connections");
    } catch (error) {
        logger.error('Error connecting to database - exiting process: ' + error);
        // Do not stop the process for debug in container service
        //process.exit(1); 
    }
    startServer();
}


function startServer() {
    if (serverStarted) return;
    serverStarted = true;
    app.listen(port);
    console.log('Application started port ' + port);
}

function checkStatus(req, res) {
    res.sendStatus(200);
}

async function createToken(req, res) {
    logger.debug('create token by user ' + req.params.user);
    if (!initialized) {
        logger.info("please wait for db connection initialized then trigger again.");
        await initDB();
        res.send(403);
    } else {
        try {
            const cs = await routes.createSessionInDB(req.params.user);
            res.send(JSON.stringify(cs));
        } catch (error) {
            res.status(404).send(error);
        }
    }
}

async function validateToken(req, res) {
    logger.debug('validate token ' + req.params.tokenid);
    if (!initialized) {
        logger.info("please wait for db connection initialized then trigger again.");
        await initDB();
        res.send(403);
    } else {
        try {
            const cs = await routes.validateSessionInDB(req.params.tokenid);
            res.send(JSON.stringify(cs));
        } catch (error) {
            res.status(404).send(error);
        }
    }
}

async function invalidateToken(req, res) {
    logger.debug('invalidate token ' + req.params.tokenid);
    if (!initialized) {
        logger.info("please wait for db connection initialized then trigger again.");
        await initDB();
        res.send(403);
    } else {
        try {
            await routes.invalidateSessionInDB(req.params.tokenid);
            res.sendStatus(200);
        }
        catch (error) {
            res.status(404).send(error);
        }
    }
}

