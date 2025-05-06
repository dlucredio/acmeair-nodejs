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


import cassandraDB from 'cassandra-driver';
import log4js from 'log4js';
import { settings } from '../../globals.js';

var logger = log4js.getLogger('dataaccess/cassandra');
logger.level = settings.loggerLevel;

const dbNames = {
    customerName: "n_customer",
    flightName: "n_flight",
    flightSegmentName: "n_flightSegment",
    bookingName: "n_booking",
    customerSessionName: "n_customerSession",
    airportCodeMappingName: "n_airportCodeMapping"
}

var upsertStmt = {
    "n_customer": "INSERT INTO n_customer (id,content) values (?, ?)",
    "n_customerSession": "INSERT INTO n_customerSession (id,content) values (?, ?)",
    "n_booking": "INSERT INTO n_booking (customerId,id,content) values (?, ?, ?)",
    "n_flight": "INSERT INTO n_flight (flightSegmentId,scheduledDepartureTime,id,content) values (?, ?, ?, ?)",
    "n_flightSegment": "INSERT INTO n_flightSegment (originPort,destPort,id,content) values (?, ?, ?,?)",
    "n_airportCodeMapping": "INSERT INTO n_airportCodeMapping (id,content) values (?, ?)"
}

var findByIdStmt = {
    "n_customer": "SELECT content from n_customer where id=?",
    "n_customerSession": "SELECT content from n_customerSession where id=?",
    "n_airportCodeMapping": "SELECT content from n_airportCodeMapping where id=?"
}

var dbConfig = calculateDBConfig();
var dbclient = null;

function calculateDBConfig() {
    var dbConfig = {};
    if (process.env.CASSANDRA_CP)
        dbConfig.contactPoints = JSON.parse(process.env.CASSANDRA_CP)
    else
        dbConfig.contactPoints = settings.cassandra_contactPoints;
    dbConfig.keyspace = process.env.CASSANDRA_KS || settings.cassandra_keyspace || "acmeair_keyspace";
    logger.info("Cassandra config:" + JSON.stringify(dbConfig));
    return dbConfig;
}


async function initializeDatabaseConnections() {
    const client = new cassandraDB.Client({ contactPoints: dbConfig.contactPoints, keyspace: dbConfig.keyspace });
    await client.connect();

    logger.info('Connected.');
    dbclient = client;
}

async function insertOne(collectionname, doc) {
    await dbclient.execute(
        upsertStmt[collectionname],
        getUpsertParam(collectionname, doc),
        { prepare: true }
    );
};

function getUpsertParam(collectionname, doc) {
    if (collectionname === 'n_booking')
        return [doc.customerId, doc._id, JSON.stringify(doc)];
    if (collectionname === 'n_flight')
        return [doc.flightSegmentId, doc.scheduledDepartureTime, doc._id, JSON.stringify(doc)];
    if (collectionname === 'n_flightSegment')
        return [doc.originPort, doc.destPort, doc._id, JSON.stringify(doc)];
    return [doc._id, JSON.stringify(doc)];

}
async function findOne(collectionname, key) {
    var query = findByIdStmt[collectionname];
    if (!query) {
        throw new Error("FindById not supported on " + collectionname);
    }

    const result = await dbclient.execute(query, [key], { prepare: true });
    return JSON.parse(result.rows[0].content);
};

async function update(collectionname, doc) {
    await dbclient.execute(
        upsertStmt[collectionname],
        getUpsertParam(collectionname, doc),
        { prepare: true }
    );
    return doc;
};

async function remove(collectionname, condition) {
    var info = getQueryInfo(collectionname, condition)
    var query = "DELETE from " + collectionname + " where " + info.whereStmt;
    logger.debug("query:" + query + ", param:" + JSON.stringify(info.param))
    await dbclient.execute(query, info.param, { prepare: true });
};

function getQueryInfo(collectionname, condition) {
    var param = [];
    var whereStmt = ""
    var first = true;
    for (var key in condition) {
        if (!first) whereStmt += " and ";
        if (key === '_id')
            whereStmt += "id=?";
        else
            whereStmt += key + "=?";
        first = false;
        param.push(condition[key]);
    }
    return { "whereStmt": whereStmt, "param": param };
}

async function findBy(collectionname, condition) {
    var info = getQueryInfo(collectionname, condition)
    var query = "SELECT content from " + collectionname + " where " + info.whereStmt;
    logger.debug("query:" + query + ", param:" + JSON.stringify(info.param))
    const result = await dbclient.execute(query, info.param, { prepare: true });
    var docs = [];
    for (var i = 0; i < result.rows.length; i++) {
        logger.debug("result[" + i + "]=" + JSON.stringify(result.rows[i]));
        docs.push(JSON.parse(result.rows[i].content));
    }
    return docs;
};

//TODO Implement count method for cassandra -- currently a stub returning -1
function count(collectionname, condition) {
    return new Promise((resolve, reject) => {
        resolve(-1);
    });
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