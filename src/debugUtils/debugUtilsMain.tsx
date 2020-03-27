import * as preact from "preact";

import { getAccesses } from "../getAccesses";
import { g, UnionUndefined } from "../misc";
import { eye0_pure, EyeLevel, GetLastKeyCountBoundsSymbol, EyeRawValue, EyeType, eye, eye3_replace, eye2_tree } from "../eye";
import { derivedRaw, derived } from "../derived";
import { exposedLookups, ExposedLookup, exposedLookupsDisplayInfo, DisplayInfo, reduceDisplayInfos } from "./exposeDebug";

import "./debugUtilsMain.css";
import { getRootKey, getChildPath, rootPath, pathFromArray, joinPathHashes, definePathSymbolName, getPathFromHash } from "../path";
import { canHaveChildren } from "../algorithms";
import { getPathQuery, SearchCol, searchCol, createSearchCollection, insertIntoCol, pathToQueryPath } from "./searcher";
import { PathQuery, QueryObject, getMatchQuery } from "./highlighter";
//import { TablePath, queryResult, queries, getTablePathHash } from "./lookupIndexer";
//import { getCellDisplayInfo, getColumnsFromDisplayInfos } from "./displayInfoIndexer";



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

//todonext;
// Making it like a database was a mistake. We should just write every table from scratch, and if we want to do
//  filtering we can add then on afterwards, at the render level of the table.
//  Yeah... because there is some massive leak right now, which I want to be able to debug, but I can't
//  without the debugger! So... I should at least make the first debugger simple...
// So... just make a generic "Table" class, which takes a { [key: string]: value }[]
interface TableData {
    name: string;
    columns: {
        name: string;
        // TODO: Any formatting information for that values (that we can't infer) should be placed in here.
    }[];
    rows: {
        [column: string]: unknown;
    }[];
}

exposedLookups;
exposedLookupsDisplayInfo;







function logValue(value: unknown) {
    // TODO: Oh, right... we can fake an error by manually crafting the callstack, in order to move the devtools IDE
    //  (or any IDE?) to any code location. Probably, haven't tried it yet.
    //  Which should be very useful...

    let rawValue = canHaveChildren(value) && EyeRawValue in value ? (value as any)[EyeRawValue] : value;
    console.log("Clicked on value", rawValue);
    window.opener.console.log("Clicked on value", rawValue);
}

class DebugArr extends preact.Component<{ arr: PropertyKey[] }, {}> {
    public render = derivedRaw(function(this: DebugArr) {
        let { arr } = this.props;
        return (
            <div className="Debug-pathValueHolder">
                {arr.map(x => <div className="Debug-pathValue">{String(x)}</div>)}
            </div>
        )
    }, { niceName: "DebugArr.render", thisContextEyeLevel: EyeLevel.eye3_replace });
}

class DebugRow extends preact.Component<{
    columns: TableData["columns"];
    row: TableData["rows"][0];
}, {}> {

    public render = derivedRaw(function(this: DebugRow) {
        let { row, columns } = this.props;

        return (
            <tr>
                {columns.map(column => {
                    let value = row[column.name];
                    return (
                        <td onClick={() => logValue(value)}>
                            {
                                Array.isArray(value) ? <DebugArr arr={value} /> :
                                typeof value === "object" ? "[object]" :
                                String(value)
                            }
                        </td>
                    );
                })}
            </tr>
        );
    }, { niceName: "DebugRow.render", thisContextEyeLevel: EyeLevel.eye3_replace });
}


class TableComponent extends preact.Component<{
    data: TableData;
}, {}> {
    //props: { data: TableData } = eye0_pure(Object.create(null)) as any;

    public render = derivedRaw(function(this: TableComponent) {
        let { name, columns, rows } = this.props.data;
        return (
            <div>
                <h2>{name} ({rows.length})</h2>
                <table>
                    <thead>
                        <tr>
                            {columns.map(column => <th>{column.name}</th>)}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map(row => {
                            return (
                                <DebugRow
                                    row={row}
                                    columns={columns}
                                />
                            );
                        })}
                    </tbody>
                </table>
            </div>
        );
    }, { niceName: "TableComponent.render", thisContextEyeLevel: EyeLevel.eye3_replace });
}

export class DebugUtils extends preact.Component<{}, {}> {

    data: {
        
    } = {
        
    };

    localStorageName = window.name + "_data2";
    componentWillMount() {
        let debugUtilsData = localStorage.getItem(this.localStorageName);
        if(debugUtilsData) {
            try {
                this.data = JSON.parse(debugUtilsData);
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
    }


    public render = derivedRaw(function(this: DebugUtils) {
        return (
            <div>
                {Object.keys(exposedLookups).sort().map(lookupName => {
                    if(lookupName === "eyePathsWatched") {
                        let lookup = exposedLookups[lookupName];
                        let data: TableData = {
                            name: lookupName,
                            rows: Object.keys(lookup).map(key => ({ key, watchCount: Object.keys(lookup[key]).length })),
                            columns: [{name: "key"}, {name: "watchCount"}],
                        };
                        return <TableComponent data={data} />;
                    }
                    if(lookupName === "pathsWatched") {
                        let lookup = exposedLookups[lookupName];
                        let data: TableData = {
                            name: lookupName,
                            rows: Object.keys(lookup).map(key => ({ path: (lookup[key] as any).path.path })),
                            columns: [{name: "path"}],
                        };
                        return <TableComponent data={data} />;
                    }

                    let lookup = exposedLookups[lookupName];
                    let rows: TableData["rows"] = Object.keys(lookup).map(x => ({
                        key: x,
                        ... lookup[x]
                    }));
                    let data: TableData = {
                        name: lookupName,
                        rows,
                        columns: rows.length > 0 ? Object.keys(rows[0]).map(x => ({ name: x })) : [],
                    };
                    return <TableComponent data={data} />;
                })}
            </div>
        );
    }, { niceName: "DebugUtils.render", thisContextEyeLevel: EyeLevel.eye3_replace });
}

