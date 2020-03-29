import { g } from "../lib/misc";
import { eye0_pure, EyePath } from "../eye";

export type ExposedLookup = { [key in PropertyKey]: object };
let lookupsToExpose: {
    [name: string]: {
        lookup: ExposedLookup;
        setLookup: (newLookup: ExposedLookup) => void;
        displayInfo?: DisplayInfo[];
    }
} = Object.create(null);

export let exposedLookups: {
    [lookupName: string]: ExposedLookup
} = eye0_pure(Object.create(null));
export let exposedLookupsDisplayInfo: {
    [lookupName: string]: {
        [pathHash: string]: DisplayInfo;
    }
} = eye0_pure(Object.create(null));


g.__exposeExposedLookups = lookupsToExpose;




export type DisplayInfo = {
    query: EyeTypes.Path2;
    // Overrides the default order, going before all non ordered columns
    //order?: number;
    type?: "lookup"|"object"|"variable";
    //typeWasInferred?: boolean;
    //isLookup?: boolean;
    //isVariable?: boolean;
    foreignKey?: {
        lookupName: string;
        useObjectKey?: boolean;
    };
    formatValue?: (value: unknown) => string;
    generatedValue?: (row: { [key in PropertyKey]: unknown }) => string|number;

    hideColumn?: boolean;
};

export function reduceDisplayInfos(accumulator: DisplayInfo|undefined, element: DisplayInfo): DisplayInfo {
    if(!accumulator) {
        return {
            ...element,
            foreignKey: !element.foreignKey ? undefined : {...element.foreignKey}
        };
    }

    if(element.type) {
        accumulator.type = element.type;
    }
    if(element.foreignKey) {
        accumulator.foreignKey = element.foreignKey;
    }
    if(element.formatValue) {
        accumulator.formatValue = element.formatValue;
    }
    if(element.generatedValue) {
        accumulator.generatedValue = element.generatedValue;
    }

    return accumulator;
}

export function exposeDebugLookup<T extends ExposedLookup>(
    name: string,
    lookup: T,
    setLookup: (newLookup: T) => void,
    displayInfo?: DisplayInfo[]
): void {
    if(name in lookupsToExpose) {
        throw new Error(`Tried to expose two lookups with the same name ${name}`);
    }
    lookupsToExpose[name] = { lookup, setLookup: setLookup as any, displayInfo };
}


function exposeDebugLookupDebugger<T extends ExposedLookup>(lookup: T, name: string, displayInfo: DisplayInfo[]): T {
    let eyeLookup = eye0_pure(lookup, name);
    exposedLookups[name] = eyeLookup;
    exposedLookupsDisplayInfo[name] = exposedLookupsDisplayInfo[name] || Object.create(null);
    for(let display of displayInfo) {
        exposedLookupsDisplayInfo[name][display.query.pathHash] = reduceDisplayInfos(exposedLookupsDisplayInfo[name][display.query.pathHash], display);
    }
    return eyeLookup;
}

g.__launchDebugUtils = launchDebugUtils;
export async function launchDebugUtils(): Promise<void> {
    let debugUrl = `/src/debugUtils/debugUtils.html`;
    let windowName = "debugUtils";
    // New window name, so we can debug debugUtils, and debug that... etc, etc, as deep as we want to go.
    let matches = /debugUtils(\d*)/.exec(window.name || "");
    if(matches) {
        windowName = windowName + ((+matches[1] || 0) + 1);
    }
    let existingWindow = window.open("", windowName, "toolbar=no,location=no,status=no,menubar=no,scrollbars=no,resizable=no,width=1,height=1");
    if(!existingWindow || existingWindow.document.location.href === "about:blank") {
        if(existingWindow) {
            existingWindow.close();
        }
        let debugUtilsWindowBase = window.open(debugUrl, windowName);
        if(!debugUtilsWindowBase) throw new Error(`Internal error`);
        console.log(`Opening debug utils`);
    } else {
        if(existingWindow.__connectToDebugUtils) {
            existingWindow.__connectToDebugUtils();
            console.log(`Instructing existing debug utils to reconnect`);
        } else {
            // else... it is probably still loading, and will call connect by itself, probably...
            console.log(`It looks like debugUtils is still loading. It should call connect on itself automatically`);
        }
    }
}

g.__connectToDebugUtils = connectToDebugUtils;
export async function connectToDebugUtils() {
    for(let key in exposedLookups) {
        delete exposedLookups[key];
        delete exposedLookupsDisplayInfo[key];
    }

    let windowToDebug = window.opener;
    let lookupsToExpose = windowToDebug.__exposeExposedLookups;
    for(let name in lookupsToExpose) {
        let { lookup, setLookup, displayInfo } = lookupsToExpose[name];
        let newLookup = exposeDebugLookupDebugger(lookup, name, displayInfo || []);
        setLookup(newLookup);
    }
}