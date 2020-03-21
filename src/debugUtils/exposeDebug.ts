import { g } from "../misc";
import { eye0_pure, EyePath } from "../eye";

type ExposedLookup = { [key in PropertyKey]: unknown };
export let exposedLookups: {
    [name: string]: {
        lookup: ExposedLookup;
        eyeLookup?: ExposedLookup;
        setLookup: (newLookup: ExposedLookup) => void;
    }
} = eye0_pure(Object.create(null));

(g as any).exposedLookups = exposedLookups;

export function exposeDebugLookup<T extends ExposedLookup>(name: string, lookup: T, setLookup: (newLookup: T) => void): void {
    exposedLookups[name] = { lookup, setLookup: setLookup as any };
}


g.__exposeDebugLookupDebugger = exposeDebugLookupDebugger;
function exposeDebugLookupDebugger<T extends { [key in PropertyKey]: unknown }>(lookup: T, name: string): T {
    let eyeLookup = eye0_pure(lookup, name);
    exposedLookups[name].eyeLookup = eyeLookup;
    return eyeLookup;
}


export async function launchDebugUtils(): Promise<void> {
    let loadId = Math.random() + "_" + Date.now();
    let debugUrl = `/src/debugUtils/debugUtils.html?loadId=${loadId}`;
    let debugUtilsWindowBase = window.open(debugUrl, "debugUtils");
    if(!debugUtilsWindowBase) throw new Error(`Internal error`);

    let debugUtilsWindow = debugUtilsWindowBase;

    console.log("Waiting for debug utils to load");

    while(new URL(debugUtilsWindow.location.href).searchParams.get("loadId") !== loadId) {
        await new Promise(resolve => setTimeout(resolve, 0));
    }

    console.log("Debug utils page loaded, waiting for javascript to load");

    // debuggerWindow is the correct window, but scripts may not have been loaded yet, so we have to wait for them to load.
    while(!debugUtilsWindow.__exposeDebugLookupDebugger) {
        await new Promise(resolve => setTimeout(resolve, 0));
    }

    console.log("Debug utils javascript loaded, exposing lookups to debug utils");

    for(let name in exposedLookups) {
        let { lookup, setLookup } = exposedLookups[name];
        let newLookup = debugUtilsWindow.__exposeDebugLookupDebugger(lookup, name);
        console.log((debugUtilsWindow as any).__eye_testIsEye(newLookup));
        //(debugUtilsWindow as any).__poke();
        //let path = (newLookup as any)[EyePath];
        //console.log("Exposed, and is path", path);
        //console.log("hmm...")
        setLookup(newLookup);
    }
}