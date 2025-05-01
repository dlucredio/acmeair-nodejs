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

import { v4 as uuidv4 } from 'uuid';
import log4js from 'log4js';
import ttlLruCache from 'ttl-lru-cache';
import createCassandraDataAccess from '../dataaccess/cassandra/index.js';
import createCloudantDataAccess from '../dataaccess/cloudant/index.js';
import createMongoDataAccess from '../dataaccess/mongo/index.js';



const dataAccessFactories = {
    cassandra: createCassandraDataAccess,
    cloudant: createCloudantDataAccess,
    mongo: createMongoDataAccess
};


export default function (dbtype, authService, settings) {
    var module = {};
    const flightCache = ttlLruCache({ maxLength: settings.flightDataCacheMaxSize });
    const flightSegmentCache = ttlLruCache({ maxLength: settings.flightDataCacheMaxSize });
    var flightDataCacheTTL = settings.flightDataCacheTTL == -1 ? null : settings.flightDataCacheTTL;

    var logger = log4js.getLogger('routes');
    logger.level = settings.loggerLevel;

    logger.info("Using db:" + dbtype);
    const dataaccess = new dataAccessFactories[dbtype](settings);

    module.dbNames = dataaccess.dbNames

    module.initializeDatabaseConnections = () => dataaccess.initializeDatabaseConnections();

    module.insertOne = (collectionname, doc) => dataaccess.insertOne(collectionname, doc);

    module.checkForValidSessionCookie = async function (req, res, next) {
        logger.debug('checkForValidCookie');
        var sessionid = req.cookies.sessionid;
        if (sessionid) {
            sessionid = sessionid.trim();
        }
        if (!sessionid || sessionid == '') {
            logger.debug('checkForValidCookie - no sessionid cookie so returning 403');
            res.sendStatus(403);
            return;
        }

        try {
            const customerid = await validateSession(sessionid);
            if (customerid) {
                logger.debug('checkForValidCookie - good session so allowing next route handler to be called');
                req.acmeair_login_user = customerid;
                next();
                return;
            }
            else {
                logger.debug('checkForValidCookie - bad session so returning 403');
                res.sendStatus(403);
                return;
            }
        } catch (err) {
            logger.debug('checkForValidCookie - system error validating session so returning 500');
            res.sendStatus(500);
        }
    }

    module.login = async function (req, res) {
        logger.debug('logging in user');
        var login = req.body.login;
        var password = req.body.password;

        res.cookie('sessionid', '');

        // replace eventually with call to business logic to validate customer
        const customerValid = await validateCustomer(login, password);
        try {
            if (!customerValid) {
                res.sendStatus(403);
            }
            else {
                try {
                    const sessionid = await createSession(login);
                    res.cookie('sessionid', sessionid);
                    res.send('logged in');
                } catch (error) {
                    logger.info(error);
                    res.send(500, error);
                }
            }
        } catch (err) {
            res.send(500, err); // TODO: do I really need this or is there a cleaner way??
        }
    };

    module.logout = async function (req, res) {
        logger.debug('logging out user');

        var sessionid = req.cookies.sessionid;
        // var login = req.body.login;
        await invalidateSession(sessionid);
        res.cookie('sessionid', '');
        res.send('logged out');
    };

    module.queryflights = async function (req, res) {
        logger.debug('querying flights');

        var fromAirport = req.body.fromAirport;
        var toAirport = req.body.toAirport;
        var fromDateWeb = new Date(req.body.fromDate);
        var fromDate = new Date(fromDateWeb.getFullYear(), fromDateWeb.getMonth(), fromDateWeb.getDate()); // convert date to local timezone
        var oneWay = (req.body.oneWay == 'true');
        var returnDateWeb = new Date(req.body.returnDate);
        var returnDate;
        if (!oneWay) {
            returnDate = new Date(returnDateWeb.getFullYear(), returnDateWeb.getMonth(), returnDateWeb.getDate()); // convert date to local timezone
        }

        let [flightSegmentOutbound, flightsOutbound] = await getFlightByAirportsAndDepartureDate(fromAirport, toAirport, fromDate);
        logger.debug('flightsOutbound = ' + flightsOutbound);
        if (flightsOutbound) {
            for (let ii = 0; ii < flightsOutbound.length; ii++) {
                flightsOutbound[ii].flightSegment = flightSegmentOutbound;
            }
        }
        else {
            flightsOutbound = [];
        }
        if (!oneWay) {
            let [flightSegmentReturn, flightsReturn] = await getFlightByAirportsAndDepartureDate(toAirport, fromAirport, returnDate);
            logger.debug('flightsReturn = ' + JSON.stringify(flightsReturn));
            if (flightsReturn) {
                for (let ii = 0; ii < flightsReturn.length; ii++) {
                    flightsReturn[ii].flightSegment = flightSegmentReturn;
                }
            }
            else {
                flightsReturn = [];
            }
            var options = {
                "tripFlights":
                    [
                        { "numPages": 1, "flightsOptions": flightsOutbound, "currentPage": 0, "hasMoreOptions": false, "pageSize": 10 },
                        { "numPages": 1, "flightsOptions": flightsReturn, "currentPage": 0, "hasMoreOptions": false, "pageSize": 10 }
                    ], "tripLegs": 2
            };
            res.send(options);
        }
        else {
            var options = {
                "tripFlights":
                    [
                        { "numPages": 1, "flightsOptions": flightsOutbound, "currentPage": 0, "hasMoreOptions": false, "pageSize": 10 }
                    ], "tripLegs": 1
            };
            res.send(options);
        }
    };

    module.bookflights = async function (req, res) {
        logger.debug('booking flights');

        var userid = req.body.userid;
        var toFlight = req.body.toFlightId;
        var retFlight = req.body.retFlightId;
        var oneWay = (req.body.oneWayFlight == 'true');

        logger.debug("toFlight:" + toFlight + ",retFlight:" + retFlight);

        const toBookingId = await bookFlight(toFlight, userid);

        if (!oneWay) {
            const retBookingId = await bookFlight(retFlight, userid);
            var bookingInfo = { "oneWay": false, "returnBookingId": retBookingId, "departBookingId": toBookingId };
            res.header('Cache-Control', 'no-cache');
            res.send(bookingInfo);
        } else {
            var bookingInfo = { "oneWay": true, "departBookingId": toBookingId };
            res.header('Cache-Control', 'no-cache');
            res.send(bookingInfo);
        }
    };

    module.cancelBooking = async function (req, res) {
        logger.debug('canceling booking');

        var number = req.body.number;
        var userid = req.body.userid;

        try {
            await cancelBooking(number, userid);
            res.send({ 'status': 'success' });
        } catch (error) {
            res.send({ 'status': 'error' });
        }
    };

    module.bookingsByUser = async function (req, res) {
        logger.debug('listing booked flights by user ' + req.params.user);

        try {
            const bookings = await getBookingsByUser(req.params.user);
            res.send(bookings);
        } catch (err) {
            res.sendStatus(500);
        }
    };

    module.getCustomerById = async function (req, res) {
        logger.debug('getting customer by user ' + req.params.user);

        try {
            const customer = await getCustomer(req.params.user);
            res.send(customer);
        } catch (err) {
            res.sendStatus(500);
        }
    };

    module.putCustomerById = async function (req, res) {
        logger.debug('putting customer by user ' + req.params.user);

        try {
            const customer = await updateCustomer(req.params.user, req.body);
            res.send(customer);
        } catch (err) {
            res.sendStatus(500);
        }
    };

    module.toGMTString = function (req, res) {
        logger.info('******* running eyecatcher function');
        var now = new Date().toGMTString();
        res.send(now);
    };

    module.getRuntimeInfo = function (req, res) {
        var runtimeInfo = [];
        runtimeInfo.push({ "name": "Runtime", "description": "NodeJS" });
        var versions = process.versions;
        for (var key in versions) {
            runtimeInfo.push({ "name": key, "description": versions[key] });
        }
        res.contentType('application/json');
        res.send(JSON.stringify(runtimeInfo));
    };

    module.getDataServiceInfo = function (req, res) {
        var dataServices = [{ "name": "cassandra", "description": "Apache Cassandra NoSQL DB" },
        { "name": "cloudant", "description": "IBM Distributed DBaaS" },
        { "name": "mongo", "description": "MongoDB NoSQL DB" }];
        res.send(JSON.stringify(dataServices));
    };

    module.getActiveDataServiceInfo = function (req, res) {
        res.send(dbtype);
    };

    module.countBookings = async function (req, res) {
        try {
            const count = await countItems(module.dbNames.bookingName);
            res.send(count.toString());
        } catch (error) {
            res.send("-1");
        }
    };

    module.countCustomer = async function (req, res) {
        try {
            const count = await countItems(module.dbNames.customerName);
            res.send(count.toString());
        } catch (error) {
            res.send("-1");
        }
    };

    module.countCustomerSessions = async function (req, res) {
        try {
            const count = await countItems(module.dbNames.customerSessionName);
            res.send(count.toString());
        } catch (error) {
            res.send("-1");
        }
    };

    module.countFlights = async function (req, res) {
        try {
            const count = await countItems(module.dbNames.flightName);
            res.send(count.toString());
        } catch (error) {
            res.send("-1");
        }
    };

    module.countFlightSegments = async function (req, res) {
        try {
            const count = await countItems(module.dbNames.flightSegmentName);
            res.send(count.toString());
        } catch (error) {
            res.send("-1");
        }
    };

    module.countAirports = async function (req, res) {
        try {
            const count = await countItems(module.dbNames.airportCodeMappingName);
            res.send(count.toString());
        } catch (error) {
            res.send("-1");
        }

    };

    async function countItems(dbName) {
        console.log("Calling count on " + dbName);
        const count = await dataaccess.count(dbName, {});
        return count;
    };

    async function validateCustomer(username, password) {
        const customer = await dataaccess.findOne(module.dbNames.customerName, username);
        if (customer) {
            return customer.password == password;
        }
        return false;
    };

    async function createSession(customerId, callback /* (error, sessionId) */) {
        if (authService) {
            authService.createSession(customerId, callback);
            return;
        }
        var now = new Date();
        var later = new Date(now.getTime() + 1000 * 60 * 60 * 24);

        var document = { "_id": uuidv4(), "customerid": customerId, "lastAccessedTime": now, "timeoutTime": later };

        await dataaccess.insertOne(module.dbNames.customerSessionName, document);
        return document._id;
    }

    async function validateSession(sessionId) {
        if (authService) {
            authService.validateSession(sessionId, (err, userid) => {
                return new Promise((resolve, reject) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(userid);
                    }
                });
            });
            return;
        }
        var now = new Date();

        const session = await dataaccess.findOne(module.dbNames.customerSessionName, sessionId);
        if (now > session.timeoutTime) {
            await dataaccess.remove(module.dbNames.customerSessionName, { '_id': sessionId });
            return null;
        }
        else {
            return session.customerid;
        }
    }

    function getCustomer(username) {
        return dataaccess.findOne(module.dbNames.customerName, username);
    }

    function updateCustomer(login, customer) {
        return dataaccess.update(module.dbNames.customerName, customer);
    }

    function getBookingsByUser(username) {
        return dataaccess.findBy(module.dbNames.bookingName, { 'customerId': username });
    }

    async function invalidateSession(sessionid) {
        if (authService) {
            authService.invalidateSession(sessionid, (err) => {
                return new Promise((resolve, reject) => {
                    reject(err);
                });
            });
            return;
        }

        await dataaccess.remove(module.dbNames.customerSessionName, { '_id': sessionid });
    }

    async function getFlightByAirportsAndDepartureDate(fromAirport, toAirport, flightDate) {
        logger.debug("getFlightByAirportsAndDepartureDate " + fromAirport + " " + toAirport + " " + flightDate);

        const flightsegment = await getFlightSegmentByOriginPortAndDestPort(fromAirport, toAirport);
        logger.debug("flightsegment = " + JSON.stringify(flightsegment));
        if (!flightsegment) {
            return [null, null];
        }

        var date = new Date(flightDate.getFullYear(), flightDate.getMonth(), flightDate.getDate(), 0, 0, 0, 0);

        var cacheKey = flightsegment._id + "-" + date.getTime();
        if (settings.useFlightDataRelatedCaching) {
            var flights = flightCache.get(cacheKey);
            if (flights) {
                logger.debug("cache hit - flight search, key = " + cacheKey);
                return [flightsegment, (flights == "NULL" ? null : flights)];
            }
            logger.debug("cache miss - flight search, key = " + cacheKey + " flightCache size = " + flightCache.size());
        }
        var searchCriteria = { flightSegmentId: flightsegment._id, scheduledDepartureTime: date };
        const docs = await dataaccess.findBy(module.dbNames.flightName, searchCriteria);
        ("after cache miss - key = " + cacheKey + ", docs = " + JSON.stringify(docs));

        var docsEmpty = !docs || docs.length == 0;

        if (settings.useFlightDataRelatedCaching) {
            var cacheValue = (docsEmpty ? "NULL" : docs);
            ("about to populate the cache with flights key = " + cacheKey + " with value of " + JSON.stringify(cacheValue));
            flightCache.set(cacheKey, cacheValue, flightDataCacheTTL);
            ("after cache populate with key = " + cacheKey + ", flightCacheSize = " + flightCache.size())
        }
        return [flightsegment, docs];
    }

    async function getFlightSegmentByOriginPortAndDestPort(fromAirport, toAirport) {
        var segment;

        if (settings.useFlightDataRelatedCaching) {
            segment = flightSegmentCache.get(fromAirport + toAirport);
            if (segment) {
                ("cache hit - flightsegment search, key = " + fromAirport + toAirport);
                return (segment == "NULL" ? null : segment);
            }
            ("cache miss - flightsegment search, key = " + fromAirport + toAirport + ", flightSegmentCache size = " + flightSegmentCache.size());
        }
        const docs = await dataaccess.findBy(
            module.dbNames.flightSegmentName,
            { originPort: fromAirport, destPort: toAirport });
        segment = docs[0];
        if (segment == undefined) {
            segment = null;
        }
        if (settings.useFlightDataRelatedCaching) {
            ("about to populate the cache with flightsegment key = " + fromAirport + toAirport + " with value of " + JSON.stringify(segment));
            flightSegmentCache.set(fromAirport + toAirport, (segment == null ? "NULL" : segment), flightDataCacheTTL);
            ("after cache populate with key = " + fromAirport + toAirport + ", flightSegmentCacheSize = " + flightSegmentCache.size())
        }
        return segment;
    }


    async function bookFlight(flightId, userid) {

        var now = new Date();
        var docId = uuidv4();

        var document = { "_id": docId, "customerId": userid, "flightId": flightId, "dateOfBooking": now };

        await dataaccess.insertOne(module.dbNames.bookingName, document);
        return docId;
    }

    async function cancelBooking(bookingid, userid) {
        await dataaccess.remove(module.dbNames.bookingName, { '_id': bookingid, 'customerId': userid })
    }

    return module;
}

