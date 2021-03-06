/*
 * This file is a part of "NMIG" - the database migration tool.
 *
 * Copyright (C) 2016 - present, Anatoly Khaytovich <anatolyuss@gmail.com>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program (please see the "LICENSE.md" file).
 * If not, see <http://www.gnu.org/licenses/gpl.txt>.
 *
 * @author Anatoly Khaytovich <anatolyuss@gmail.com>
 */
import DBAccessQueryResult from './DBAccessQueryResult';
import Conversion from './Conversion';
import DBAccess from './DBAccess';
import DBVendors from './DBVendors';
import * as extraConfigProcessor from './ExtraConfigProcessor';

/**
 * Updates consistency state.
 */
async function updateConsistencyState(conversion: Conversion, dataPoolId: number): Promise<void> {
    const logTitle: string = 'ConsistencyEnforcer::updateConsistencyState';
    const sql: string = `UPDATE "${ conversion._schema }"."data_pool_${ conversion._schema }${ conversion._mySqlDbName }" 
        SET is_started = TRUE WHERE id = ${ dataPoolId };`;

    const dbAccess: DBAccess = new DBAccess(conversion);
    await dbAccess.query(logTitle, sql, DBVendors.PG, false, false);
}

/**
 * Retrieves the `is_started` value of current chunk.
 */
async function getIsStarted(conversion: Conversion, dataPoolId: number): Promise<boolean> {
    const logTitle: string = 'ConsistencyEnforcer::getIsStarted';
    const sql: string = `SELECT is_started AS is_started 
        FROM "${ conversion._schema }"."data_pool_${ conversion._schema }${ conversion._mySqlDbName }" 
        WHERE id = ${ dataPoolId };`;

    const dbAccess: DBAccess = new DBAccess(conversion);
    const result: DBAccessQueryResult = await dbAccess.query(logTitle, sql, DBVendors.PG, false, false);
    return result.error ? false : !!result.data.rows[0].is_started;
}

/**
 * Current data chunk runs after a disaster recovery.
 * Must determine if current chunk has already been loaded.
 * This is in order to prevent possible data duplications.
 */
async function hasCurrentChunkLoaded(conversion: Conversion, chunk: any): Promise<boolean> {
    const logTitle: string = 'ConsistencyEnforcer::hasCurrentChunkLoaded';
    const originalTableName: string = extraConfigProcessor.getTableName(conversion, chunk._tableName, true);
    const sql: string = `SELECT EXISTS(SELECT 1 FROM "${ conversion._schema }"."${ chunk._tableName }" 
        WHERE "${ conversion._schema }_${ originalTableName }_data_chunk_id_temp" = ${ chunk._id });`;

    const dbAccess: DBAccess = new DBAccess(conversion);
    const result: DBAccessQueryResult = await dbAccess.query(logTitle, sql, DBVendors.PG, false, false);
    return result.error ? true : !!result.data.rows[0].exists;
}

/**
 * Determines consistency state.
 */
async function getConsistencyState(conversion: Conversion, chunk: any): Promise<boolean> {
    const isStarted: boolean = await getIsStarted(conversion, chunk._id);

    // "isStarted" is false in normal migration flow.
    return isStarted ? hasCurrentChunkLoaded(conversion, chunk) : false;
}

/**
 * Enforces consistency before processing a chunk of data.
 * Ensures there are no any data duplications.
 * In case of normal execution - it is a good practice.
 * In case of rerunning Nmig after unexpected failure - it is absolutely mandatory.
 */
export async function enforceConsistency(conversion: Conversion, chunk: any): Promise<boolean> {
    const hasAlreadyBeenLoaded: boolean = await getConsistencyState(conversion, chunk);

    if (hasAlreadyBeenLoaded) {
        // Current data chunk runs after a disaster recovery.
        // It has already been loaded.
        return false;
    }

    // Normal migration flow.
    await updateConsistencyState(conversion, chunk._id);
    return true;
}

/**
 * Drops the {conversion._schema + '_' + originalTableName + '_data_chunk_id_temp'} column from current table.
 */
export async function dropDataChunkIdColumn(conversion: Conversion, tableName: string): Promise<void> {
    const logTitle: string = 'ConsistencyEnforcer::dropDataChunkIdColumn';
    const originalTableName: string = extraConfigProcessor.getTableName(conversion, tableName, true);
    const columnToDrop: string = `${ conversion._schema }_${ originalTableName }_data_chunk_id_temp`;
    const sql: string = `ALTER TABLE "${ conversion._schema }"."${ tableName }" DROP COLUMN "${ columnToDrop }";`;
    const dbAccess: DBAccess = new DBAccess(conversion);
    await dbAccess.query(logTitle, sql, DBVendors.PG, false, false);
}
