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

// Dataaccess must implement 
//	 	dbNames:  { customerName:, flightName:, flightSegmentName:, bookingName:, customerServiceName:, airportCodeMappingName:}
// 		initializeDatabaseConnections(function(error))
// 		insertOne(collname, doc, function(error, doc))
// 		findOne(collname, _id value, function(error, doc))
//		update(collname, doc, function(error, doc))
//		remove(collname, condition as json of field and value, function(error))
// 		findBy(collname, condition as json of field and value,function(err, docs))
//		TODO: count(collname, condition as json of field and value, function(error, count))


import log4js from 'log4js';
import createNano from 'nano';
import { settings } from '../../globals.js';

var logger = log4js.getLogger('dataaccess/cloudant');
logger.level = settings.loggerLevel;

const dbNames = {
    customerName: "n_customer",
    flightName: "n_flight",
    flightSegmentName: "n_flightsegment",
    bookingName: "n_booking",
    customerSessionName: "n_customersession",
    airportCodeMappingName: "n_airportcodemapping"
}

var dbConfig = calculateDBConfig();
const nano = createNano(dbConfig.hosturl); // may need to set the connection pool here.

// TODO does cache the db by dbName improve performance?
var nanoDBs = {};
nanoDBs[dbNames.airportCodeMappingName] = nano.db.use(dbNames.airportCodeMappingName);
nanoDBs[dbNames.bookingName] = nano.db.use(dbNames.bookingName);
nanoDBs[dbNames.customerName] = nano.db.use(dbNames.customerName);
nanoDBs[dbNames.customerSessionName] = nano.db.use(dbNames.customerSessionName);
nanoDBs[dbNames.flightName] = nano.db.use(dbNames.flightName);
nanoDBs[dbNames.flightSegmentName] = nano.db.use(dbNames.flightSegmentName);

async function initializeDatabaseConnections() {
}

function calculateDBConfig() {

    var dbConfig;
    if (process.env.VCAP_SERVICES) {
        var env = JSON.parse(process.env.VCAP_SERVICES);
        logger.log("env: %j", env);
        var serviceKey = Object.keys(env)[0];
        dbConfig = env[serviceKey][0]['credentials'];
    }
    if (!dbConfig) {
        if (process.env.CLOUDANT_URL) {
            dbConfig = { "hosturl": process.env.CLOUDANT_URL };
        }
    }
    if (!dbConfig) {
        dbConfig = {
            "host": settings.cloudant_host,
            "port": settings.cloudant_port || 443,
            "username": settings.cloudant_username,
            "password": settings.cloudant_password
        }
    }
    if (!dbConfig.hosturl) {
        dbConfig.hosturl = "https://" + dbConfig.username + ":" + dbConfig.password + "@" + dbConfig.host + ":" + dbConfig.port;
    }
    logger.info("Cloudant config:" + JSON.stringify(dbConfig));
    return dbConfig;
}

function insertOne(collectionname, doc) {
    return new Promise((resolve, reject) => {
        nanoDBs[collectionname].insert(doc, doc._id, function (err, doc) {
            if (err) {
                logger.error(err);
                reject(err);
            } else {
                resolve(doc);
            }
        });
    });
};

function findOne(collectionname, key) {
    return new Promise((resolve, reject) => {
        nanoDBs[collectionname].get(key, function (err, doc) {
            if (err) {
                logger.error(err);
                reject(err);
            } else {
                resolve(doc);
            }
        });
    });
};

function update(collectionname, doc) {
    return new Promise((resolve, reject) => {
        getRevision(nanoDBs[collectionname], doc._id, function (error, revision) { // Has to get revision as the customer passed from ui lost revision
            if (error) reject(error);
            else {
                doc._rev = revision;
                nanoDBs[collectionname].insert(doc, doc._id, function (err, body) {
                    if (err) reject(err);
                    else {
                        resolve(doc);
                    }
                });
            }
        });
    });
};

function getRevision(db, id, callback/*(error, revision)*/) {
    db.head(id, function (err, _, headers) {
        if (!err) {
            var revision = headers.etag;
            revision = revision.substring(1, revision.length - 1);
            callback(null, revision);
        }
        else callback(err, null);
    })
}

function remove(collectionname, condition) {
    return new Promise((resolve, reject) => {
        getRevision(nanoDBs[collectionname], condition._id, function (err, revision) {
            if (!err) {
                nanoDBs[collectionname].destroy(condition._id, revision, function (error, body) {
                    reject(error);
                });
            }
            else {
                reject(err);
            }
        });
    })
};

function findBy(collectionname, condition) {
    return new Promise((resolve, reject) => {

        var searchCriteria = "";

        for (var attrName in condition) {
            if (searchCriteria.length != 0)
                searchCriteria += " AND ";
            searchCriteria += attrName + ":" + JSON.stringify(condition[attrName]);
        }

        logger.debug("search:" + searchCriteria);
        nanoDBs[collectionname].search("view", collectionname + "s", { q: searchCriteria, include_docs: true }, function (err, docs) {
            if (err) {
                logger.error("Hit error:" + err);
                reject(err);
            } else
                resolve(getDocumentFromQuery(docs));
        });
    })
}

function getDocumentFromQuery(document) {
    logger.debug("translate document from query:" + JSON.stringify(document));
    var docs = [];
    for (i = 0; i < document.total_rows; i++)
        docs[i] = document.rows[i].doc;
    logger.debug("translated document from query:" + JSON.stringify(docs));
    return docs;
}

//TODO Implement count method for cloudant -- currently a stub returning -1
function count(collectionname, condition) {
    return new Promise((resolve, reject) => {
        resolve(-1);
    })
};

export default {
    dbNames,
    initializeDatabaseConnections,
    insertOne,
    findOne,
    update,
    remove,
    findBy,
    count
}
