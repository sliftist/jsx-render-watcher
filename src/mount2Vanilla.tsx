import { Mount2, mountRerender, mount2Internal, mountContextSymbol, MountContext, ComponentInstance, ComponentInstanceState, componentInstanceStateSymbol, CreateComponent, ComponentInstanceClass, JSXNode } from "./mount2";
import { insertIntoListMapped } from "./lib/algorithms";


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
    let context = rootElement[mountContextSymbol];
    if(context) {
        // TODO: Actually... maybe we should warn, or error? Because if we render twice to the same place, the rerenders will break each other.
        return mount2Internal(rootElement as any, context as any, { rootJSX: virtualDom, treeNodes: {}, parentComponent: undefined }, XSSComponentCheck);
    }

    
    let components: { [id: string]: {
        instance: ClassInstance;
    } } = {};

    let updateQueue: ((ComponentInstance&ComponentInstanceState)[])|undefined = undefined;
    function rootRunCode(code: () => void) {
        updateQueue = [];
        try {
            code();
    
            while(updateQueue.length > 0) {
                let component = updateQueue[0];
                updateQueue.shift();
                mountRerender(component, XSSComponentCheck);
            }
        }  catch(e) {
            // Bad, it means we won't be properly running update queue
            debugger;
            throw e;
        } finally {
            updateQueue = undefined;
        }
    }

    return Mount2<ClassInstance>(
        rootElement,
        () => {
            return true;
        },
        rootRunCode,
        // create
        ({ props, Class }) => {
            let instance = new Class(props);
            instance.props = props;
            instance.componentId = Date.now() + "_" + Math.random();

            function forceUpdate(callback?: () => void) {
                if(updateQueue !== undefined) {
                    insertIntoListMapped(updateQueue, instance as any as (ComponentInstance&ComponentInstanceState), x => x[componentInstanceStateSymbol].treeNode.depth, (a, b) => a - b, "ignore");
                } else {
                    // as any, as types are added by Mount2 to our instance after we return it.
                    mountRerender(instance as any, XSSComponentCheck);
                }
        
                if(callback) {
                    rootRunCode(callback);
                }
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
            components[instance.componentId] = { instance };
            return instance;
        },
        // update
        (instance, newProps) => {
            components[instance.componentId].instance.props = newProps;
        },
        // delete
        () => {},
        {
            rootJSX: virtualDom,
            treeNodes: {},
            parentComponent: undefined
        },
        XSSComponentCheck
    );
}
