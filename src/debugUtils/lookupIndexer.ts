// import { derived } from "../derived";
// import { QueryObject, getMatchQuery } from "./highlighter";
// import { eye0_pure } from "../eye";
// import { exposedLookups } from "./exposeDebug";
// import { getPathQuery, SearchCol, createSearchCollection, insertIntoCol } from "./searcher";
// import { definePathSymbolName } from "../path";
// import { getCellDisplayInfo } from "./displayInfoIndexer";
// import { canHaveChildren } from "../algorithms";

// export type TablePath = (PropertyKey | QueryObject)[];

// export function getTablePathHash(tablePath: TablePath): string {
//     return getPathQuery(tablePath).pathHash;
// }


// export let queries: { [queryPathHash: string]: TablePath } = eye0_pure(Object.create(null));
// derived(() => {
//     // TODO: Support removing exposedLookups with a delta watch. This allows us to change pages
//     //  without having to refresh the debugger (and is just more correct in general).
//     for(let lookupName in exposedLookups) {
//         let tablePath: TablePath = [lookupName];
//         let hash = getTablePathHash(tablePath);
//         if(!(hash in queries)) {
//             queries[hash] = tablePath;
//         }
//     }
// }, "defaultQueryPopulator");
// export let queryResult: {
//     [queryPathHash: string]: {
//         query: TablePath;
//         /** Full path is the full path, including the key */
//         //rowByFullPath: SearchCol<{ query: EyeTypes.Path2; }>;
//         // The query is just the key within the table
//         rows: SearchCol<{ query: EyeTypes.Path2; row: unknown; rowTablePath: TablePath; }>;
//         /*
//         // The query includes the row key, and the value key
//         keys: SearchCol<{ query: EyeTypes.Path2; row: unknown; }>;
//         // The query is just String(value), trimmed to only be N characters
//         values: SearchCol<{ query: EyeTypes.Path2; row: unknown; }>;
//         */
//     }
// } = eye0_pure(Object.create(null));




// const rowIsPrimitive = Symbol("rowIsPrimitive");
// definePathSymbolName(rowIsPrimitive, "rowIsPrimitive");

// derived(() => {
//     Object.keys(queries).forEach(queryPathHash => {
//         let query = queries[queryPathHash];
//         if(query.length === 0) {
//             throw new Error(`Invalid query, length of 0.`);
//         }
//         let tablePart = query[0];
//         if(typeof tablePart === "object") {
//             throw new Error(`Invalid query, table part must be constant`);
//         }

//         type Lookup = { [key in PropertyKey]: unknown };
//         let lookups: { lookup: Lookup; path: TablePath; }[] = [];
//         let rootLookup = exposedLookups[tablePart as any];
//         if(rootLookup) {
//             lookups.push({ lookup: rootLookup, path: [tablePart] });
//         }

//         //todonext;
//         // Oh... we need to collapse joins... when we get the same values.
//         //  Oh, and...

//         for(let i = 1; i < query.length; i++) {
//             let queryPart = query[i];
//             let nextLookups: typeof lookups = [];

//             let cellDisplayInfo = getCellDisplayInfo(query.slice(0, i + 1));
            
//             for(let lookupObj of lookups) {
//                 let lookup = lookupObj.lookup;
//                 let lookupPath = lookupObj.path;
//                 function addValue(key: PropertyKey) {
//                     let value = lookup[key as string];

//                     let path = lookupPath.concat(key);

//                     if(cellDisplayInfo && cellDisplayInfo.foreignKey) {
//                         let foreignObj = cellDisplayInfo.foreignKey;

//                         key = foreignObj.useObjectKey ? key : String(value);
//                         value = exposedLookups[foreignObj.lookupName][key as string];
//                         path = [foreignObj.lookupName, key];
//                     }

//                     if(canHaveChildren(value)) {
//                         nextLookups.push({
//                             lookup: value,
//                             path
//                         });
//                     }
//                 }
//                 if(typeof queryPart === "object") {
//                     for(let key in lookup) {
//                         let matched = getMatchQuery(queryPart.query, [key], false);
//                         if(matched) {
//                             addValue(key);
//                         }
//                     }
//                 } else {
//                     addValue(queryPart);
//                 }
//             }

//             lookups = nextLookups;
//         }

//         let rows: SearchCol<{ query: EyeTypes.Path2; row: unknown; rowTablePath: TablePath; }> = createSearchCollection();

//         for(let lookupObj of lookups) {
//             let { lookup, path } = lookupObj;
//             for(let rowKey in lookup) {
//                 if(String(rowKey).includes("Object")) {
//                     //debugger;
//                 }
//                 let row = lookup[rowKey];
//                 let rowTablePath = path.concat(rowKey);

//                 let cellDisplayInfo = getCellDisplayInfo(query.concat(rowKey));
//                 if(cellDisplayInfo?.foreignKey && cellDisplayInfo.foreignKey.useObjectKey) {
//                     let foreignLookup = cellDisplayInfo.foreignKey.lookupName;
//                     row = exposedLookups[foreignLookup][rowKey];
//                     rowTablePath = [foreignLookup, rowKey];
//                 }

//                 // Ignore duplicates, as joins might overlap
//                 insertIntoCol(rows, { query: getPathQuery(rowTablePath), row, rowTablePath }, true);
//                 /*
//                 insertIntoCol(rowByFullPath, { query: getChildPath(path, rowKey) });
//                 let rowKeyPath = getRootKey(rowKey);
//                 insertIntoCol(rows, { query: rowKeyPath, rowKey: rowKey });
//                 function addCell(value: unknown, valueKey: PropertyKey) {
//                     insertIntoCol(keys, { query: getChildPath(rowKeyPath, valueKey), rowKey: rowKey, key: valueKey });

//                     let valueSearchStr = String(value).slice(0, 200);

//                     insertIntoCol(values, { query: getRootKey(valueSearchStr), rowKey: rowKey, key: valueKey, value, valueSearchStr });
//                 }

//                 let row = lookup[rowKey];

//                 if(canHaveChildren(row)) {
//                     for(let valueKey in row) {
//                         addCell(row[valueKey], valueKey);
//                     }
//                 } else {
//                     addCell(row, rowIsPrimitive);
//                 }
//                 */
//             }
//         }

//         queryResult[queryPathHash] = {
//             query,
//             rows,
//         };
//     });
// }, "lookupSearchIndexer");