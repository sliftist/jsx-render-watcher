import * as preact from "preact";

import { g, UnionUndefined } from "../lib/misc";
import { eye0_pure, EyeLevel, EyeRawValue, EyeType, eye, eye1_replace } from "../eye";
import { derivedRaw, derived } from "../derived";
import { exposedLookups, ExposedLookup, exposedLookupsDisplayInfo, DisplayInfo, reduceDisplayInfos } from "./exposeDebug";

import "./debugUtilsMain.css";
import { getRootKey, getChildPath, rootPath, pathFromArray, joinPathHashes, definePathSymbolName, getPathFromHash } from "../lib/path";
import { canHaveChildren } from "../lib/algorithms";
import { getPathQuery, SearchCol, searchCol, createSearchCollection, insertIntoCol, pathToQueryPath } from "./searcher";
import { PathQuery, QueryObject, getMatchQuery } from "./highlighter";
//import { TablePath, queryResult, queries, getTablePathHash } from "./lookupIndexer";
//import { getCellDisplayInfo, getColumnsFromDisplayInfos } from "./displayInfoIndexer";

//todonext
// And then for nested derived... maybe... we should globally hoist it. This does mean if you
//  make a change to an array, and then run a map in the same function, you changes won't be reflected...
//  but... even in a normal case the function will need to be rerun anyway... And delta Array.map
//  won't allow implicitly closing on values anyway... I think? UGH, but... it would be nice if it could...
//  - But... how can we allow closing upon variables?
//todonext
// UGH! Okay, how hard should it be to tell which variables are closed upon? I guess... all functions calls
//  are closed upon, and that... unfortunate. But... we could probably parse to see if they are declared
//  in the root derived state (and actually, that is fine, because then they are unique functions, so really...
//  we just want to know all closed upon variables...).
//  AND... if they call one of our functions... hmm... we could probably finagle them into calling
//  a function of our choice with an argument of our choice. Which... let's us trick them into evaling
//  a string, and accessing their scope.
// Maybe... SpecialMapHoistScopes()(SpecialMap(array, function))
//  Of course, function better be in the current scope, or else we can't even hoist the scope! Or... at least
//  it better share the scope, it can be a class member function, that is fine... But if it is a function
//  in another module, you're going to get into trouble. And then we can tell if the root function changes
//  just be .toString(), which since we are checking the scope, is actually perfect.
//  - OH! Well, of course, if you call some library function that uses global state, that won't work.
//      - Although... we could wrap every closed upon variable, and then parse any functions before calling,
//          checking their closed upon variables too... But no, let's not do that. Doing that could get REALLY
//          hairy, really quickly...


// User stories:
//  - From the UI
//      - Find the direct derived for that UI
//      - Visually see when a derived changes, with options to filter what I am seeing
//  - From a derived
//      - See values derived is watching
//      - See history of watches
//      - See history of writes to watches
//      - See a list of child map deriveds
//todonext
// Describe this more
//          - These can be determined by deriveds looking for a parent derived context in their constructor,
//              and then registering in that as being children
//  - From data
//      - Find a derived or list of deriveds from a nice name, or code location.
//      - Drill into data value from the root, for... speculative data searching? Although... is this really useful?
//  - From value/eye/valuepath
//      - Find deriveds that use it
//      - Find write history
//      - Find code that writes to it
//  - From source line
//      - Values (eyes) written to, and read from
//          - As in, across all active derived, or possibly the derived that exist at a specific time? Or region of time?
//      - Derived that touch this line
//      - The places in the UI that this impacts / that impact it?
//  - A variable slice, which gives every code location that writes to an eye value,
//      and then for all of those locations which are in a derived, take those derived, the values
//      that they read from, and then all the code locations which write to those values, etc, etc,
//      giving a slice (really a tree), of what impacts a value.

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
    }, "DebugArr.render", undefined, EyeLevel.eye1_replace);
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
    }, "DebugRow.render", undefined, EyeLevel.eye1_replace);
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
    }, "TableComponent.render", undefined, EyeLevel.eye1_replace);
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
                {Object.keys(exposedLookups).map(lookupName => {
                    if(lookupName === "pathsWatched") return false;
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
    }, "DebugUtils.render", undefined, EyeLevel.eye1_replace);
}

