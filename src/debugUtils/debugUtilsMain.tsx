import * as preact from "preact";

import { getAccesses } from "../getAccesses";
import { g, UnionUndefined } from "../misc";
import { eye0_pure, EyeLevel, GetLastKeyCountBoundsSymbol, EyeRawValue, EyeType } from "../eye";
import { derivedRaw, derived } from "../watcher";
import { exposedLookups, ExposedLookup, exposedLookupsDisplayInfo, DisplayInfo, reduceDisplayInfos } from "./exposeDebug";

import "./debugUtilsMain.css";
import { getRootKey, getChildPath, rootPath, pathFromArray, joinPathHashes, definePathSymbolName, getPathFromHash } from "../path";
import { canHaveChildren } from "../algorithms";
import { getPathQuery, SearchCol, searchCol, createSearchCollection, insertIntoCol, pathToQueryPath } from "./searcher";
import { PathQuery, QueryObject, getMatchQuery } from "./highlighter";
import { TablePath, queryResult, queries, getTablePathHash } from "./lookupIndexer";
import { getCellDisplayInfo, getColumnsFromDisplayInfos } from "./displayInfoIndexer";



// User stories:
//  - From the UI
//      - Find the direct derived for that UI
//      - Visually see when a derived changes, with options to filter what I am seeing
//  - From a derived
//      - See values derived is watching
//      - See history of watches
//      - See history of writes to watches
//  - From data
//      - Find a derived or list of deriveds from a nice name, or code location.
//      - Drill into data value from the root, for... speculative data searching? Although... is this really useful?
//  - From value/eye/valuepath
//      - Find deriveds that use it
//      - Find write history
//      - Find code that writes to it

// todonext;
// Making it like a database was a mistake. We should just write every table from scratch, and if we want to do
//  filtering we can add then on afterwards, at the render level of the table.







function logValue(value: unknown) {
    // TODO: Oh, right... we can fake an error by manually crafting the callstack, in order to move the devtools IDE
    //  (or any IDE?) to any code location. Probably, haven't tried it yet.
    //  Which should be very useful...

    let rawValue = canHaveChildren(value) && EyeRawValue in value ? (value as any)[EyeRawValue] : value;
    console.log("Clicked on value", rawValue);
    window.opener.console.log("Clicked on value", rawValue);
}

class DebugArr extends preact.Component<{ arr: PropertyKey[] }, {}> {
    public render() {
        let { arr } = this.props;
        return (
            <div className="Debug-pathValueHolder">
                {arr.map(x => <div className="Debug-pathValue">{String(x)}</div>)}
            </div>
        )
    }
}

class DebugRow extends preact.Component<{
    row: unknown;
    rowTablePath: TablePath;
    rowKey: PropertyKey | QueryObject;
    columns: PropertyKey[];
    rowDisplayInfo: DisplayInfo|undefined;
}, {}> {
    public render() {

        let { row, rowTablePath, columns, rowKey, rowDisplayInfo } = this.props;

        let keyCell = (
            <td onClick={() => logValue(row)}>
                <DebugArr arr={rowTablePath.map(x => typeof x === "object" ? x.query : x)} />
            </td>
        );
        if(rowDisplayInfo?.hideColumn) {
            keyCell = <preact.Fragment />;
        }

        if(rowDisplayInfo && rowDisplayInfo.type === "lookup") {
            return (
                <tr>
                    {keyCell}
                    <td>[LOOKUP]({Object.keys(row as any).length})</td>
                </tr>
            );
        }

        if(!canHaveChildren(row)) {
            return (
                <tr>
                    {keyCell}
                    <td>{String(row)}</td>
                </tr>
            );
        }
        let rowTyped = row;

        let extraKeys: { [key: string]: true } = Object.create(null);
        for(let key in row) {
            let displayInfo = getCellDisplayInfo(rowTablePath.concat(key));
            if(displayInfo && displayInfo.hideColumn) continue;
            extraKeys[key] = true;
        }
        for(let column of columns) {
            delete extraKeys[String(column)];
        }

        return (
            <tr>
                {keyCell}
                {columns.map(column => {
                    let value = rowTyped[column as string];
                    let displayInfo = getCellDisplayInfo(rowTablePath.concat(column));
                    if(displayInfo) {
                        if(displayInfo.generatedValue) {
                            value = displayInfo.generatedValue(rowTyped);
                        }
                        if(displayInfo.formatValue) {
                            value = displayInfo.formatValue(value);
                        }
                        if(displayInfo.type === "object") {
                            value = "[Object]";
                        }
                        if(displayInfo.type === "lookup") {
                            value = `[Lookup]`;
                        }
                    }
                    return (
                        <td onClick={() => logValue(value)}>
                            {Array.isArray(value) ? <DebugArr arr={value} /> : String(value)}
                        </td>
                    );
                })}
                <td>
                    <DebugArr arr={Object.keys(extraKeys)} />
                </td>
            </tr>
        );
    }
}


class TableComponent extends preact.Component<{
    tablePath: TablePath;
}, {}> {
    private renderTable() {
        let { tablePath } = this.props;

        let result = UnionUndefined(queryResult[getTablePathHash(tablePath)]);

        if(!result) {
            return { jsx: <div>Table results not indexed</div>, count: undefined };
        }

        let { rows } = result;

        // TODO: Add a filter to the UI, and properly show highlighting
        let filteredRows = searchCol(rows, getPathQuery({ query: "" }));

        if(filteredRows.length === 0) {
            return { jsx: <div>No results</div>, count: undefined };
        }

        // We assume there aren't specific display infos per row... because that would mean a collection is
        //  not homeogeneous, which we don't support.
        let rowTablePath = filteredRows[0].elem.rowTablePath;

        // rowTablePath, so we get the resolved values.
        let columns = getColumnsFromDisplayInfos(rowTablePath.slice(0, -1));
        let rowDisplayInfo = getCellDisplayInfo(rowTablePath);

        return {
            count: filteredRows.length,
            jsx: (
                <table>
                    <thead>
                        <tr>
                            {!rowDisplayInfo?.hideColumn && <th>Key</th>}
                            {columns.map(column => <th>{column}</th>)}
                            <th>Extra Keys</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredRows.map(filteredRow => {
                            return (
                                <DebugRow
                                    row={filteredRow.elem.row}
                                    rowTablePath={filteredRow.elem.rowTablePath}
                                    rowDisplayInfo={rowDisplayInfo}
                                    rowKey={filteredRow.elem.rowTablePath[filteredRow.elem.rowTablePath.length - 1]}
                                    columns={columns}
                                />
                            );
                        })}
                    </tbody>
                </table>
            )
        };
    }

    public render = derivedRaw(function(this: TableComponent) {
        let { tablePath } = this.props;
        let { jsx, count } = this.renderTable();
        return (
            <div>
                <h2>{JSON.stringify(tablePath)}{count !== undefined ? ` (${count})` : undefined}</h2>
                {jsx}
            </div>
        );
    }, { niceName: "TableComponent.render", thisContextEyeLevel: EyeLevel.eye3_replace });
}

export class DebugUtils extends preact.Component<{}, {}> {

    data: {
        queries: {
            /** Need to be the hash, as we store and load this from the disk. */
            queryHash: string;
        }[]
    } = {
        queries: [
            { queryHash: getPathQuery(["eyePathsWatched", { query: "render" }]).pathHash }
        ]
    };

    localStorageName = window.name + "_data2";
    componentWillMount() {
        let debugUtilsData = localStorage.getItem(this.localStorageName);
        if(debugUtilsData) {
            try {
                //this.data = JSON.parse(debugUtilsData);
            } catch(e) {
                console.log(`Error loading debugUtilsData from localStorage`);
            }
        }
    }

    componentDidMount() {
        // If we do deriveds in our didMount, it will be after our first render, and so all of the data
        //  accessed in render will have be eye-ified, making this derived work. Otherwise we will be accessing
        //  raw values, which won't generate any subscriptions.
        derived(() => {
            let dataJSON = JSON.stringify(this.data);
            localStorage.setItem(this.localStorageName, dataJSON);
        }, "dataToLocalStorage");

        derived(() => {
            // TODO: Support removing exposedLookups with a delta watch. This allows us to change pages
            //  without having to refresh the debugger (and is just more correct in general).
            for(let query of this.data.queries) {
                let path = getPathFromHash(query.queryHash);
                let tablePath = pathToQueryPath(path);
                if(!Array.isArray(tablePath)) {
                    throw new Error(`Root table queries must have a path.`);
                }
                queries[path.pathHash] = tablePath;
            }
        }, "data.queries to queries");
    }


    public render = derivedRaw(function(this: DebugUtils) {
        return (
            <div>
                {Object.values(queries).map(tablePath => <TableComponent tablePath={tablePath} />)}
            </div>
        );
    }, { niceName: "DebugUtils.render", thisContextEyeLevel: EyeLevel.eye3_replace });
}

