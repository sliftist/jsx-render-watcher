import { Mount2, mountRerender, mountContextSymbol, MountContext, ComponentInstance, ComponentInstanceState, componentInstanceStateSymbol, CreateComponent, ComponentInstanceClass, JSXNode } from "./mount2";
import { insertIntoListMapped, binarySearchMapped, compareString } from "./lib/algorithms";


type ClassInstance = ComponentInstance & {
    componentId: string;
    context?: any;
    setState?: any;
    forceUpdate?: any;
};
export function MountVanillaComponents(
    virtualDom: JSXNode,
    rootElement: ChildNode & { [mountContextSymbol]?: MountContext<ClassInstance> },
    /** If true, elements are only recognized when they have a property called: ["$$typeof"], equal to Symbol.for("react.element"). Otherwise they are rendered
     *      as objects are (the key being the fragment key, the property being a value, the result always being text nodes, and never elements).
     */
    XSSComponentCheck: boolean
): void {
    let componentIds = new Map<ComponentInstance, string>();
    let nextId = 0;
    function getComponentId(instance: ComponentInstance): string {
        let id = componentIds.get(instance);
        if(id === undefined) {
            // pad, so 2 -> "02", because "02" < "10" (as opposed to "2" > "10")
            id = (nextId++).toFixed(10);
        }
        return id;
    }
    let pathCache = new WeakMap<ComponentInstance, string>();
    function getComponentIdPath(instance: ComponentInstance): string {
        let value = pathCache.get(instance);
        if(value !== undefined) return value;

        let path = "";
        while(instance) {
            // ":" > [0-9], so children sort after parents.
            path = getComponentId(instance) + ":" + path;
            // TODO: Verify this is correct, I forget if parentComponent jumps across trees (all the time? or just some of the time? or what...)
            let nextInstance = instance[componentInstanceStateSymbol].parentComponent;
            if(!nextInstance) break;
            instance = nextInstance;
        }
        pathCache.set(instance, path);
        return path;
    }
    function getParentComponentId(instance: ComponentInstance): string {
        let parent = instance[componentInstanceStateSymbol].parentComponent;
        if(!parent) return "";
        return getComponentIdPath(parent);
    }

    let rerenderQueue: ComponentInstance[]|undefined = undefined;
    function callRerender(instance: ClassInstance) {
        if(rerenderQueue === undefined) {
            rerenderQueue = [];
            let curQueue = rerenderQueue;
            Promise.resolve().then(() => {
                rerenderQueue = undefined;
                for(let component of curQueue) {
                    mountRerender(component);
                }
            });
        }

        if(binarySearchMapped(rerenderQueue, getParentComponentId(instance), getComponentIdPath, compareString) >= 0) {
            // Don't add it if it has parents that are re-rendering.
            return;
        }

        let path = getComponentId(instance);
        let index = binarySearchMapped(rerenderQueue, path, getComponentIdPath, compareString);
        if(index >= 0) {
            // Don't add it multiple times
            return;
        }
        index = ~index;
        // Remove all descendants
        while(index < rerenderQueue.length && getComponentIdPath(rerenderQueue[index]).startsWith(path)) {
            rerenderQueue.splice(index, 1);
        }
        rerenderQueue.splice(index, 0, instance);
    }


    return Mount2<ClassInstance>(
        virtualDom,
        rootElement,
        XSSComponentCheck,
        () => {
            return true;
        },
        (code) => code(),
        // create
        ({ props, Class }) => {
            let instance = new Class(props);
            instance.props = props;
            instance.componentId = Date.now() + "_" + Math.random();

            function forceUpdate(callback?: () => void) {
                callRerender(instance);
                Promise.resolve().then(() => {
                    if(callback) {
                        callback();
                    }
                });
            }

            (instance as any as React.Component<{}, {}>).setState = function(newState: { [key: string]: unknown }, callback?: () => void) {
                instance.state = instance.state || {};
                for(let key in newState) {
                    (instance.state as any)[key] = newState[key];
                }

                forceUpdate(callback);
            };
            (instance as any as React.Component<{}, {}>).forceUpdate = function(callback?: () => void) {
                forceUpdate(callback);
            };
            return instance;
        },
        // update
        (instance, newProps) => {
            instance.props = newProps;
        },
        // delete
        () => {}
    );
}
