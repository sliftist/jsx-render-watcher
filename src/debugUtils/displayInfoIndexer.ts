// // Populate this from exposedLookupsDisplayInfo, so exposedLookupsDisplayInfo is easily searchable
// //  (not for speed, just for convenience of stackability...). Perhaps even make it so the collection supports

// import { SearchCol, createSearchCollection, insertIntoCol, getPathQuery, searchCol, pathToQueryPath } from "./searcher";

// import { DisplayInfo, exposedLookupsDisplayInfo, reduceDisplayInfos } from "./exposeDebug";

// import { eye0_pure } from "../eye";

// import { derived } from "../derived";

// import { TablePath } from "./lookupIndexer";

// //  overlaps, so we can collapse display infos as late as possible?
// export let displayInfos: { [lookupName: string]: SearchCol<DisplayInfo> } = eye0_pure(Object.create(null));
// derived(() => {
//     // TODO: Use object deltas to properly remove from the collections
//     for(let lookupName in exposedLookupsDisplayInfo) {
//         if(!displayInfos[lookupName]) {
//             displayInfos[lookupName] = createSearchCollection();
//         }
//         let col = displayInfos[lookupName];
//         let displayInfoLookup = exposedLookupsDisplayInfo[lookupName];
//         Object.values(displayInfoLookup).forEach(displayInfo => {
//             insertIntoCol(col, displayInfo, true);
//         });
//     }
// }, "displayInfosIndexer");

// /** Follows any foreign keys (as defined by DisplayInfo), to get the path under the table (the full table path) */
// function getRawDisplayInfo(absoluteTablePath: TablePath): DisplayInfo[]|undefined {
//     let lookupName = absoluteTablePath[0];
//     if(typeof lookupName !== "string") {
//         throw new Error(`Table part of tablePath must be a string, was ${typeof lookupName}`);
//     }
//     if(!(lookupName in displayInfos)) return undefined;
//     let col = displayInfos[lookupName];
    
//     let displayInfoPath = getPathQuery(absoluteTablePath.slice(1));

//     let matchedInfos = searchCol(col, displayInfoPath);
//     return matchedInfos.map(x => x.elem);
// }

// export function getColumnsFromDisplayInfos(tablePath: TablePath): string[] {
//     // NOTE: The way we do this means if any filtering completely removes a column... then that filtering will
//     //  have to detect and remove that column itself. Which should be fairly easy, it can just apply it's filter
//     //  also to the column DisplayInfo paths (with getMatchQuery).
//     // Match all row keys, and all value keys.
//     tablePath = tablePath.concat({ query: "" }).concat({ query: "" });
//     let displayInfos = getRawDisplayInfo(tablePath);
//     if(!displayInfos) return [];
    
//     let cellKeys: {
//         [key in PropertyKey]: true
//     } = Object.create(null);

//     for(let info of displayInfos) {
//         let query = pathToQueryPath(info.query);
//         if(!Array.isArray(query)) continue;
//         let cellKey = query[query.length - 1];
//         if(typeof cellKey !== "object") {
//             cellKeys[cellKey as string] = true;
//         }
//     }

//     return Object.keys(cellKeys);
// }
// export function getCellDisplayInfo(cellPath: TablePath): DisplayInfo|undefined {
//     let displayInfos = getRawDisplayInfo(cellPath);
//     if(!displayInfos) return undefined;
//     return displayInfos.reduce(reduceDisplayInfos, undefined);
// }
