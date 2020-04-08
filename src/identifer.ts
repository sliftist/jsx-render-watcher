const niceNameSeqNum: Map<string, number> = new Map();
export function createNewIdentifier(
    niceName: string = "eye",
    suffix: string = ""
): string {
    if(niceName !== "eye") {
        niceName = niceName.replace(/_/g, "__");
    }
    let seqNum = niceNameSeqNum.get(niceName);
    if(seqNum === undefined) {
        seqNum = 0;
        niceNameSeqNum.set(niceName, 0);
    }
    niceNameSeqNum.set(niceName, seqNum + 1);

    if(seqNum === 0 && suffix === "") {
        return niceName;
    }

    suffix = suffix.replace(/_/g, "__");

    let str = niceName + "_";
    str += suffix;
    str += seqNum;
    return str;
}

let idObjSeqNum = 0;
let idObjSeqNumMap = new WeakMap<object, number>();
let idNiceNameMap = new Map<string, object>();
export function getObjIdentifier(id: object, key: string|number, idNiceName?: string) {
    if(typeof id !== "object" || !id) {
        throw new Error(`Invalid object id, it wasn't an Object.`);
    }
    let prefix: string = "";
    let prefixDone = false;
    if(idNiceName) {
        idNiceName = idNiceName.replace(/_/g, "__");
        let prevObj = idNiceNameMap.get(idNiceName);
        prefix += idNiceName;
        if(prevObj === undefined) {
            prefixDone = true;
            idNiceNameMap.set(idNiceName, id);
        } else if(prevObj === id) {
            prefixDone = true;
        }
    }
    if(!prefixDone) {
        if(prefix) {
            prefix += "_";
        }
        let seqNum = idObjSeqNumMap.get(id);
        if(seqNum === undefined) {
            seqNum = idObjSeqNum++;
            idObjSeqNumMap.set(id, seqNum);
        }
        prefix += seqNum;
    }
    
    return prefix + "_." + String(key);
}


// TODO: Use WeakRefs to do this better. Right now if a child is destructed but not a parent we won't know to get rid of the parent.
//  (And we also store too many objects). With WeakRefs we can perfectly keep track of if any path is reachable, and if not, we can remove
//  the entire path.
type NestedWeakMap = WeakMap<object, { value: object; children: NestedWeakMap|undefined; }>;
let nestedWeakMaps: NestedWeakMap = new WeakMap();
export function getCombinedObjectHash(...objs: object[]): object {
    let curMap = nestedWeakMaps;
    for(let i = 0; i < objs.length; i++) {
        let obj = objs[i];
        let next = curMap.get(obj);
        if(next === undefined) {
            next = { value: Object.create(null), children: undefined };
            curMap.set(obj, next);
        }
        if(i === objs.length - 1) {
            return next.value;
        }
        if(next.children === undefined) {
            next.children = new WeakMap();
        }
        curMap = next.children;
    }
    throw new Error(`Internal error, unreachable`);
}