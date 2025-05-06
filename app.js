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

import express from 'express';
import log4js from 'log4js';
import routes from './routes/index.js';
import loader from './loader/loader.js';
import morgan from 'morgan';
import bodyParser from 'body-parser';
import methodOverride from 'method-override';
import cookieParser from 'cookie-parser';
import { settings } from './globals.js';

var logger = log4js.getLogger('app');
logger.level = settings.loggerLevel;

// disable process.env.PORT for now as it cause problem on mesos slave
var port = (process.env.VMC_APP_PORT || process.env.VCAP_APP_PORT || settings.port);
var host = (process.env.VCAP_APP_HOST || 'localhost');

logger.info("host:port==" + host + ":" + port);

// const routes = new createRoutes();
// const loader = new createLoader(routes, settings);

// Setup express with 4.0.0

var app = express();

app.use(express.static('public'));     	// set the static files location /public/img will be /img for users
if (settings.useDevLogger)
    app.use(morgan('dev'));                     		// log every request to the console

//create application/json parser
var jsonParser = bodyParser.json();
// create application/x-www-form-urlencoded parser
var urlencodedParser = bodyParser.urlencoded({ extended: false });

app.use(jsonParser);
app.use(urlencodedParser);
//parse an HTML body into a string
app.use(bodyParser.text({ type: 'text/html' }));

app.use(methodOverride());                  			// simulate DELETE and PUT
app.use(cookieParser());                  				// parse cookie

var router = express.Router();

router.post('/login', login);
router.get('/login/logout', logout);
router.post('/flights/queryflights', routes.checkForValidSessionCookie, routes.queryflights);
router.post('/bookings/bookflights', routes.checkForValidSessionCookie, routes.bookflights);
router.post('/bookings/cancelbooking', routes.checkForValidSessionCookie, routes.cancelBooking);
router.get('/bookings/byuser/:user', routes.checkForValidSessionCookie, routes.bookingsByUser);
router.get('/customer/byid/:user', routes.checkForValidSessionCookie, routes.getCustomerById);
router.post('/customer/byid/:user', routes.checkForValidSessionCookie, routes.putCustomerById);
router.get('/config/runtime', routes.getRuntimeInfo);
router.get('/config/dataServices', routes.getDataServiceInfo);
router.get('/config/activeDataService', routes.getActiveDataServiceInfo);
router.get('/config/countBookings', routes.countBookings);
router.get('/config/countCustomers', routes.countCustomer);
router.get('/config/countSessions', routes.countCustomerSessions);
router.get('/config/countFlights', routes.countFlights);
router.get('/config/countFlightSegments', routes.countFlightSegments);
router.get('/config/countAirports', routes.countAirports);
//router.get('/loaddb', startLoadDatabase);
router.get('/loader/load', loadDatabase);
router.get('/loader/query', loader.getNumConfiguredCustomers);
router.get('/checkstatus', checkStatus);


//REGISTER OUR ROUTES so that all of routes will have prefix 
app.use(settings.contextRoot, router);

function checkStatus(req, res) {
    res.sendStatus(200);
}

async function login(req, res) {
    await routes.login(req, res);
}

async function logout(req, res) {
    await routes.logout(req, res);
}

async function loadDatabase(req, res) {
    logger.info("Started to load database...");
    const result = await loader.startLoadDatabase(req.query.numCustomers);
    res.send(result);
}

app.listen(port);
logger.info("Express server listening on port " + port);
