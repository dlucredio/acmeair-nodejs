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
import { settings, dbtype } from '../globals.js';
import getDataAccess from '../dataaccess/dataaccess.js';

const flightCache = ttlLruCache({ maxLength: settings.flightDataCacheMaxSize });
const flightSegmentCache = ttlLruCache({ maxLength: settings.flightDataCacheMaxSize });
var flightDataCacheTTL = settings.flightDataCacheTTL == -1 ? null : settings.flightDataCacheTTL;

var logger = log4js.getLogger('routes');
logger.level = settings.loggerLevel;

async function insertOne(collectionname, doc) {
    logger.debug("insertOne: "+collectionname+" - " + doc);
    const dataaccess = await getDataAccess();
    return await dataaccess.insertOne(collectionname, doc);
}

async function checkForValidSessionCookie(req, res, next) {
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
    logger.debug("Validating session cookie. Sessionid="+sessionid);


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

async function login(req, res) {
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
                logger.debug("Logged in. Session id="+sessionid);
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

async function logout(req, res) {
    logger.debug('logging out user');

    var sessionid = req.cookies.sessionid;
    // var login = req.body.login;
    await invalidateSession(sessionid);
    res.cookie('sessionid', '');
    res.send('logged out');
};

async function queryflights(req, res) {
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

    let [flightSegmentOutbound, flightsOutbound] = await getFlightByAirportsAndDepartureDate(fromAirport, toAirport, fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate());
    logger.debug('flightsOutbound = ' + JSON.stringify(flightsOutbound));
    if (flightsOutbound) {
        for (let ii = 0; ii < flightsOutbound.length; ii++) {
            flightsOutbound[ii].flightSegment = flightSegmentOutbound;
        }
    }
    else {
        flightsOutbound = [];
    }
    if (!oneWay) {
        let [flightSegmentReturn, flightsReturn] = await getFlightByAirportsAndDepartureDate(toAirport, fromAirport, returnDate.getFullYear(), returnDate.getMonth(), returnDate.getDate());
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

async function bookflights(req, res) {
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

async function cancelBooking(req, res) {
    logger.debug('canceling booking');

    var number = req.body.number;
    var userid = req.body.userid;

    try {
        await cancelBookingInDB(number, userid);
        res.send({ 'status': 'success' });
    } catch (error) {
        res.send({ 'status': 'error' });
    }
};

async function bookingsByUser(req, res) {
    logger.debug('listing booked flights by user ' + req.params.user);

    try {
        const bookings = await getBookingsByUser(req.params.user);
        res.send(bookings);
    } catch (err) {
        res.sendStatus(500);
    }
};

async function getCustomerById(req, res) {
    logger.debug('getting customer by user ' + req.params.user);

    try {
        const customer = await getCustomer(req.params.user);
        res.send(customer);
    } catch (err) {
        res.sendStatus(500);
    }
};

async function putCustomerById(req, res) {
    logger.debug('putting customer by user ' + req.params.user);

    try {
        const customer = await updateCustomer(req.params.user, req.body);
        res.send(customer);
    } catch (err) {
        res.sendStatus(500);
    }
};

async function toGMTString(req, res) {
    logger.info('******* running eyecatcher function');
    var now = new Date().toGMTString();
    res.send(now);
};

async function getRuntimeInfo(req, res) {
    var runtimeInfo = [];
    runtimeInfo.push({ "name": "Runtime", "description": "NodeJS" });
    var versions = process.versions;
    for (var key in versions) {
        runtimeInfo.push({ "name": key, "description": versions[key] });
    }
    res.contentType('application/json');
    res.send(JSON.stringify(runtimeInfo));
};

function getDataServiceInfo(req, res) {
    var dataServices = [{ "name": "cassandra", "description": "Apache Cassandra NoSQL DB" },
    { "name": "cloudant", "description": "IBM Distributed DBaaS" },
    { "name": "mongo", "description": "MongoDB NoSQL DB" }];
    res.send(JSON.stringify(dataServices));
};

function getActiveDataServiceInfo(req, res) {
    res.send(dbtype);
};

async function countBookings(req, res) {
    try {
        const dataaccess = await getDataAccess();
        const count = await countItems(dataaccess.dbNames.bookingName);
        res.send(count.toString());
    } catch (error) {
        res.send("-1");
    }
};

async function countCustomer(req, res) {
    try {
        const dataaccess = await getDataAccess();
        const count = await countItems(dataaccess.dbNames.customerName);
        res.send(count.toString());
    } catch (error) {
        res.send("-1");
    }
};

async function countCustomerSessions(req, res) {
    try {
        const dataaccess = await getDataAccess();
        const count = await countItems(dataaccess.dbNames.customerSessionName);
        res.send(count.toString());
    } catch (error) {
        res.send("-1");
    }
};

async function countFlights(req, res) {
    try {
        const dataaccess = await getDataAccess();
        const count = await countItems(dataaccess.dbNames.flightName);
        res.send(count.toString());
    } catch (error) {
        res.send("-1");
    }
};

async function countFlightSegments(req, res) {
    try {
        const dataaccess = await getDataAccess();
        const count = await countItems(dataaccess.dbNames.flightSegmentName);
        res.send(count.toString());
    } catch (error) {
        res.send("-1");
    }
};

async function countAirports(req, res) {
    try {
        const dataaccess = await getDataAccess();
        const count = await countItems(dataaccess.dbNames.airportCodeMappingName);
        res.send(count.toString());
    } catch (error) {
        res.send("-1");
    }

};

async function countItems(dbName) {
    console.log("Calling count on " + dbName);
    const dataaccess = await getDataAccess();
    const count = await dataaccess.count(dbName, {});
    return count;
};

async function validateCustomer(username, password) {
    const dataaccess = await getDataAccess();
    const customer = await dataaccess.findOne(dataaccess.dbNames.customerName, username);
    if (customer) {
        return customer.password == password;
    }
    return false;
};

async function createSession(customerId) {
    var now = new Date();
    var later = new Date(now.getTime() + 1000 * 60 * 60 * 24);

    var document = { "_id": uuidv4(), "customerid": customerId, "lastAccessedTime": now, "timeoutTime": later };

    const dataaccess = await getDataAccess();
    await dataaccess.insertOne(dataaccess.dbNames.customerSessionName, document);
    return document._id;
}

async function validateSession(sessionId) {
    var now = new Date();

    const dataaccess = await getDataAccess();
    const session = await dataaccess.findOne(dataaccess.dbNames.customerSessionName, sessionId);
    if (now > session.timeoutTime) {
        await dataaccess.remove(dataaccess.dbNames.customerSessionName, { '_id': sessionId });
        return null;
    }
    else {
        return session.customerid;
    }
}

async function getCustomer(username) {
    const dataaccess = await getDataAccess();
    return await dataaccess.findOne(dataaccess.dbNames.customerName, username);
}

async function updateCustomer(login, customer) {
    const dataaccess = await getDataAccess();
    return await dataaccess.update(dataaccess.dbNames.customerName, customer);
}

async function getBookingsByUser(username) {
    const dataaccess = await getDataAccess();
    return await dataaccess.findBy(dataaccess.dbNames.bookingName, { 'customerId': username });
}

async function invalidateSession(sessionid) {
    const dataaccess = await getDataAccess();
    await dataaccess.remove(dataaccess.dbNames.customerSessionName, { '_id': sessionid });
}

async function getFlightByAirportsAndDepartureDate(fromAirport, toAirport, flightDateYear, flightDateMonth, flightDateDate) {
    logger.debug("getFlightByAirportsAndDepartureDate " + fromAirport + " " + toAirport + " " + flightDateMonth+"/"+flightDateDate+"/"+flightDateYear);

    const flightsegment = await getFlightSegmentByOriginPortAndDestPort(fromAirport, toAirport);
    logger.debug("flightsegment = " + JSON.stringify(flightsegment));
    if (!flightsegment) {
        return [null, null];
    }

    var date = new Date(flightDateYear, flightDateMonth, flightDateDate, 0, 0, 0, 0);

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
    const dataaccess = await getDataAccess();
    const docs = await dataaccess.findBy(dataaccess.dbNames.flightName, searchCriteria);
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
    const dataaccess = await getDataAccess();
    const docs = await dataaccess.findBy(
        dataaccess.dbNames.flightSegmentName,
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

    const dataaccess = await getDataAccess();
    await dataaccess.insertOne(dataaccess.dbNames.bookingName, document);
    return docId;
}

async function cancelBookingInDB(bookingid, userid) {
    const dataaccess = await getDataAccess();
    await dataaccess.remove(dataaccess.dbNames.bookingName, { '_id': bookingid, 'customerId': userid })
}

export default {
    insertOne,
    checkForValidSessionCookie,
    login,
    logout,
    queryflights,
    bookflights,
    cancelBooking,
    bookingsByUser,
    getCustomerById,
    putCustomerById,
    toGMTString,
    getRuntimeInfo,
    getDataServiceInfo,
    getActiveDataServiceInfo,
    countBookings,
    countCustomer,
    countCustomerSessions,
    countFlights,
    countFlightSegments,
    countAirports
}