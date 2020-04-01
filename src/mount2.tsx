/** Copied directly out of query-sub, from src/sync/html/mount2.tsx */

/**     SUMMARY
 * 
 *  For each DOM node we have a child virtual tree, which we follow until we find another dom node, at which
 *      point we stop that virtual tree.
 * 
 *  Re-renders always start with a DOM node, and some part of their virtual tree which changes, which then results
 *      in some child DOM nodes changing, being created, moved, etc, and then THEIR virtual trees being
 *      triggered, until everything updates.
 */

import { UnionUndefined, isPrimitive, isArray } from "./lib/type";

import { insertIntoListMapped, binarySearchMapped, sort, unreachable } from "./lib/algorithms";

import "./lib/listExtensions_g";
import { keyBy, isShallowEqual } from "./lib/misc";
import { LongestSequence } from "./lib/longestSequence";
import { setAccessor } from "./lib/preact-dom";
import { arrayDelta, ArrayDeltaObj } from "./delta";

export const mountContextSymbol = Symbol("mountContextSymbol");
export const mountTree = Symbol("mountTree");

const reactSymbol = Symbol.for("react.element");

export function CleanNode(childNode: ChildNode & DOMNodeExtraSymbols) {
    delete childNode[mountTree];
}

interface DOMNodeExtraSymbols {
    [mountTree]?: RenderTreeChild;
}

interface LookupTypeBase { [key: string]: unknown }
interface LookupType extends LookupTypeBase {
    children?: JSXNode;
}

type JSXElement<T extends LookupType = LookupType> = {
    type: (
        // Created as a dom node
        string
        // Called as a function
        | ((props: T) => JSXNode)
        // Created as a component
        | ComponentInstanceClass
    );
    key?: number|string|null;
    props: T;
};
export type JSXNode = JSXElement | Exclude<Types.Primitive, void> | undefined | void | JSXNode[] | object;
export type JSXNodeLeaf = JSXElement | Exclude<Types.Primitive, void> | undefined | void;


type BaseComponentProps = { [key: string]: unknown };

export interface ComponentProps extends BaseComponentProps { }



export const componentInstanceStateSymbol = Symbol("componentInstanceStateSymbol");
export type ComponentInstanceState = {
    [componentInstanceStateSymbol]: {
        parentDomNode: ChildNode & DOMNodeExtraSymbols;
        parentComponent: ComponentInstance|undefined;
        treeNode: RenderTreeChild;
    }
};

export type ComponentInstance = ComponentInstanceState & {
    render(): JSXNode;
    props?: LookupType;
    state?: LookupType;
};
export abstract class ComponentInstanceClass<Props = { [key: string]: unknown }> {
    abstract render(): JSXNode;
    abstract props: Props;
}

export interface CreateComponent<ComponentType extends ComponentInstance> {
    (
        params: {
            props: { [key: string]: unknown };
            Class: { new(props: ComponentProps): ComponentType }
            parent: ComponentType|undefined;
        }
    ): ComponentType;
}
export interface UpdateComponentProps<ComponentType extends ComponentInstance> {
    (instance: ComponentType, newProps: { [key: string]: unknown },
        //parentRenderDependencies: { [hash: string]: Sync.NotifyDependency }
    ): void;
}
export interface OnRemoveComponent<ComponentType extends ComponentInstance> {
    (instance: ComponentType): void;
}


/** Called when a function property is added to an element. The returned function is used to override the function. */
export interface AddFncPropCallback {
    (elementPlusPropId: string, fnc: Function, propertyName: string, elem: ChildNode, instance: ComponentInstance|undefined, elementId: string): Function;
}
/** Only called when the function changes, so if you pass a static or class level function this won't be called. */
export interface ChangedFncPropCallback {
    (id: string, newFnc: Function, instance: ComponentInstance|undefined): Function;
}
/** Called when the elment is no longer mounted. After this the id will never be passed to change or add again. */
export interface RemoveFncPropCallback {
    (id: string, instance: ComponentInstance|undefined): void;
}




type RenderTreeChildBase = {
    key: string|null;
    
    pendingVirtualDom: JSXNode;

    // Set to false when we are moving it around. This is set in batches, so our movement
    //  doesn't trip up on itself.
    attachedToDOM: boolean;
    // A temporary variable we use in our reconcilation code
    tempPrevIndex: number;
    tempNewIndex: number;
    // The identifying name describing the type of the tree node. Anything that has a typeName
    //  equal to this node may be matched with this node during reconcilation.
    //  - For dom nodes this means the nodes (not their children, or dom properties, just the nodes themselves) better
    //      be interchangable, or else the parent node type will be wrong.
    // setTypeName
    typeName: string;

    seqId: number;

    // Used to allow modifying a component that is one of many children, without have to iterate through
    //  all the children in order to find where the component's nodes should be inserted.
    prevSiblingNode: RenderTreeChild|undefined;

    // If type === "component", this is just the component at this node. Otherwise, it is the component
    //  of nearest ancestor, or undefined if that doesn't exist.
    //  Once set never changes, which makes sense because if a component is reused with new jsx, the
    //      instance we be reused as well (that is kind of the point)
    readonly component: ComponentInstance|undefined;

    parentTreeNode: RenderTreeChild|undefined;

    readonly context: MountContext;
};


type RenderTreeChildLeaf = RenderTreeChildBase & {
    type: "domNode";
    jsxType: string; // type if it is a DOMElement, otherwise just "primitive"
    jsx: JSXNodeLeaf;
    childNode: ChildNode & DOMNodeExtraSymbols;

    /** The next tree, unconnected to us except by this connection, which isn't usually iterated on. */
    childTree: RenderTreeChildKeyOnly|undefined;
};

type RenderTreeChildComponent = RenderTreeChildBase & {
    type: "component";
    componentType: string;
    component: ComponentInstance & ComponentInstanceState;
    prevProps: { [key: string]: unknown };

    jsx: JSXNode;

    nested: RenderTreeChild[];
    /** If true, it means that when rendered the jsx had to be flattened from a NESTED array, pure component,
     *      or key lookup object. Which means the jsx array (or single element) isn't parallel with nested,
     *      and requires expansion to map between the jsx and child trees.
     */
    jsxWasFlattened: boolean;
};
type RenderTreeChildKeyOnly = RenderTreeChildBase & {
    type: "keyOnly";
    key: string;

    nested: RenderTreeChild[];
    jsxWasFlattened: boolean;
};

type RenderTreeChild = (
    RenderTreeChildLeaf
    | RenderTreeChildComponent
    | RenderTreeChildKeyOnly
);


export function getTypeNameFromDOM(node: ChildNode) {
    if(node.nodeType === 3 /* Node.TEXT_NODE */) {
        return "__primitive";
    } else if(node.nodeType === 1 /* Node.ELEMENT_NODE */) {
        return "__type" + (node as HTMLElement).tagName.toLowerCase();
    } else {
        throw new Error(`Unsupported DOM node type ${node.nodeType}`);
    }
}

function isNodePrimitive(node: ChildNode): node is Text {
    // Node.TEXT_NODE
    return node.nodeType === 3;
}
function isNodeElement(node: ChildNode): node is HTMLElement {
    // Node.ELEMENT_NODE
    return node.nodeType === 1;
}


function createJSXFromNode(node: ChildNode): JSXNodeLeaf {
    if(isNodePrimitive(node)) {
        return node.nodeValue;
    } else if(isNodeElement(node)) {
        let props: { [key: string]: unknown } = {};
        for(let attributeName of node.getAttributeNames()) {
            let attributeValue = node.getAttribute(attributeName);
            if(attributeName === "class") {
                attributeName = "className";
            }
            props[attributeName] = attributeValue;
        }
        return {
            type: node.tagName,
            props: props,
            // TODO: For server side rendering we need to output an attribute for key, so we can match attributes properly.
            //  Also... something with components, probably. Or... we could just send the RenderTree, which will also allow
            //  matching with components.
            key: null,
        };
    } else {
        throw new Error(`Unsupported DOM node type ${node.nodeType}`);
    }
}


let nextSeqId = 1;

export interface MountContext<OurComponentType extends ComponentInstance = ComponentInstance> {
    XSSComponentCheck: boolean;
    isFncTriggered: (fnc: Function) => boolean;
    runRootCode: (code: () => void) => void;
    createComponent: CreateComponent<OurComponentType>;
    updateComponentProps: UpdateComponentProps<OurComponentType>;
    onRemoveComponent: OnRemoveComponent<OurComponentType>;
    addFncPropCallback: AddFncPropCallback;
    changedFncPropCallback: ChangedFncPropCallback;
    removeFncPropCallback: RemoveFncPropCallback;
    // TODO: I think we need "addEventCallbackFnc" and "removeEventCallbackFnc" handlers, which are maintained automatically,
    //  given the virtual dom returned from the render function.
    //  (similar to the createComponent/update/whatever functions, but basically just pretending event callbacks are like components,
    //      just another class).
    //  - We should probably pass the dom node type as well.
    //  - Functions passed to components can be ignored, as passing functions around is okay, and if a child hooks the function up
    //      to an event handler it will get called anyway (assuming functions in props works, which I don't think it does anyway...)
    //  - ALSO support support addEventCallbackFnc adding (synced) parameters to the callbacks, and provide the context it is called in.
    //      - The idea is to automatically track the value of inputs, store it somewhere in the synced state (somewhere with the component),
    //          and then pass a reference to that synced value/object to override the event argument. And we should probably
    //          override all event arguments, forcing the user to use synced values (although we might want to still include an escape hatch,
    //          or some override to add their own event -> sync mappings, in case they use event properties we didn't implement).
}

function wrapWithRootCodeFnc(fnc: Function, runRootCode: (code: () => void) => void) {
    return function(this: any, ...args: any[]) {
        let result!: any;
        // Event callbacks should always be root calls, so this should be okay.
        runRootCode(function(this: any) {
            result = fnc.apply(this, args);
        });
        return result;
    }
}

/** Creates a dom node that contains the entire child tree for a child.
 *      - There was no reason to hold the ChildNode of the parent, because this only changes
 *          when the parent dom nodes changes, as children of dom elements can independently change
 *          (only components can independently change, and they DO store their ChildNode parent).
*/
function createDomChildrenTreeNode(
    context: MountContext,
    jsx: JSXNode,
    component: ComponentInstance|undefined,
): RenderTreeChildKeyOnly {
    return {
        key: "root",
        // keyOnly, just because we only support a few types, and we don't support any "raw, but no key" type, because...
        //  usually the only reason for raw nodes is to apply keys...
        type: "keyOnly",
        pendingVirtualDom: jsx,

        attachedToDOM: true,
        tempNewIndex: 0,
        tempPrevIndex: 0,
        typeName: "",

        nested: [],
        seqId: nextSeqId++,
        
        
        prevSiblingNode: undefined,
        component,

        parentTreeNode: undefined,

        context,

        jsxWasFlattened: false
    };
}

export function Mount2<ComponentType extends ComponentInstance>(
    jsx: JSXNode,
    parentNode: ChildNode & DOMNodeExtraSymbols,
    /** If true, elements are only recognized when they have a property called: ["$$typeof"], equal to Symbol.for("react.element"). Otherwise they are rendered
     *      as objects are (the key being the fragment key, the property being a value, the result always being text nodes, and never elements).
     */
    XSSComponentCheck: boolean,
    isFncTriggered: (fnc: Function) => boolean,
    runRootCode: (code: () => void) => void,
    createComponent: CreateComponent<ComponentType>,
    updateComponentProps: UpdateComponentProps<ComponentType>,
    onRemoveComponent: OnRemoveComponent<ComponentType>,
    addFncPropCallback: AddFncPropCallback = (id, fnc) => wrapWithRootCodeFnc(fnc, runRootCode),
    changedFncPropCallback: ChangedFncPropCallback = (id, fnc) => wrapWithRootCodeFnc(fnc, runRootCode),
    removeFncPropCallback: RemoveFncPropCallback = () => {},
): void {


    let rootRenderTree: RenderTreeChild|undefined = parentNode[mountTree];
    if(!rootRenderTree) {
        let contextNew: MountContext<ComponentType> = {
            XSSComponentCheck,
            addFncPropCallback, changedFncPropCallback, createComponent, isFncTriggered, onRemoveComponent, removeFncPropCallback, runRootCode, updateComponentProps
        };
        let context = contextNew as any as MountContext;

        rootRenderTree = createDomChildrenTreeNode(context, jsx, undefined);

        // TODO: Instead of removing all existing children, we could load in the existing DOM into a virtual dom tree, that way
        //  we don't have to recreate the entire DOM (instead we just read all of it, which should be faster then recreating it...).
        let { childNodes } = parentNode;
        for(let i = childNodes.length - 1; i >= 0; i--) {
            childNodes[i].remove();
        }
    }
    parentNode[mountTree] = rootRenderTree;

    mount2Tree(rootRenderTree, parentNode);
}

export function mountRerender(
    component: (ComponentInstance & ComponentInstanceState),
) {
    // TODO: If we ever want to do component sibling swaps we should accept an array of components to rerender
    //  (as multiple might be pending to rerender), but for now... we rerender components in isolation anyway,
    //  so there is no reason to batch them.

    let { parentDomNode, treeNode } = component[componentInstanceStateSymbol];

    // TODO: Actually... if multiple siblings are triggered this can be faster. HOWEVER, it is a bit tricky to detect this with
    //  a single priority number in SyncFunctions, so we would need to accept many components, and

    mount2Tree(treeNode, parentDomNode);
}

function setPropertyWrapper(treeNode: RenderTreeChildLeaf, name: string, oldValue: unknown, value: unknown, nodeRemoved = false) {
    if(treeNode.jsxType === "primitive") {
        throw new Error(`Impossible, invalid call, primitives won't have properties.`);
    }
    // If the oldValue is a function, and the new one isn't, then it is being removed
    // If the oldValue wasn't, and the new one is, then it is being added

    let node = treeNode.childNode as HTMLElement;
    let valueIsFnc = typeof value === "function";
    let oldValueIsFnc = typeof oldValue === "function";
    if(valueIsFnc || oldValueIsFnc) {
        let id = treeNode.seqId + "_" + name;
        if(!valueIsFnc) {
            // removed
            treeNode.context.removeFncPropCallback(id, treeNode.component);
        } else if(!oldValueIsFnc) {
            // added
            let mappedFnc = treeNode.context.addFncPropCallback(id, value as Function, name, node, treeNode.component, treeNode.seqId.toString());
            Object.assign(mappedFnc, { mount2OriginalFnc: value });
            value = mappedFnc;
        } else {
            // changed
            let mappedFnc = treeNode.context.changedFncPropCallback(id, value as Function, treeNode.component);
            Object.assign(mappedFnc, { mount2OriginalFnc: value });
            value = mappedFnc;
        }
    }
    if(nodeRemoved) return;
    setAccessor(node, name, oldValue, value, false);
}



/** Mount/remount the given virtual tree */
function mount2Tree(
    tree: RenderTreeChild,
    parentNode: ChildNode & DOMNodeExtraSymbols
) {
    let context = tree.context;

    let { isFncTriggered, createComponent, updateComponentProps, onRemoveComponent } = context;

    let document = parentNode.ownerDocument as Document;

    updateTreeNode(tree);

    return;

    function getText(jsx: unknown): string {
        let text = "";
        if(!jsxHasOutput(jsx)) {
            text = "";
        } else {
            text = String(jsx);
        }
        return text;
    }
    function jsxHasOutput(jsx: unknown) {
        return !(jsx === null || jsx === undefined || jsx === false || jsx === true);
    }

    // Only called for components, or domNodes (which are always terminal)
    //  - Does not attach to the dom, just creates the node
    //  - Does not recursively create the node, leaves that to updateTreeNode by setting pendingVirutalDom
    //  - Does not set dom properties, updateTreeNode does that
    function createTreeNode(
        newJSX: JSXNode,
        parent: RenderTreeChild
    ): RenderTreeChild {

        //console.log(`create node`, Date.now() % 1000);

        // 1) Add key attributes around components (which isn't trivial, because of fragments)
        // 2) Change it so we use our own createElement, which we can use to record line information of the React.createElement,
        //  which we can then use to make an onClick handler that prints the line it came from
        // 3) Add source map support, so it prints the .ts line information too.

        let createdNode: RenderTreeChild;

        if(isPrimitive(newJSX)) {
            let text = getText(newJSX);
            
            let seqId = nextSeqId++;
            let childNode = document.createTextNode(text);
            let nodeTyped: RenderTreeChildLeaf = createdNode = {
                type: "domNode",
                jsxType: "primitive",
                jsx: undefined,
                childNode,

                key: null,
                pendingVirtualDom: newJSX,

                attachedToDOM: false,
                tempNewIndex: 0,
                tempPrevIndex: 0,
                typeName: "",

                seqId,

                prevSiblingNode: undefined,

                component: parent.component,

                parentTreeNode: parent,

                context,

                childTree: undefined
            };

            if(jsxHasOutput(newJSX)) {
                nodeTyped.childTree = createDomChildrenTreeNode(context, newJSX, parent.component)
            }

            setTypeName(nodeTyped);
        } else if("type" in newJSX) {
            let key = newJSX.key != null ? String(newJSX.key) : null;

            if(context.XSSComponentCheck && !(reactSymbol in newJSX)) {
                throw new Error(`Object which looked like XSS attempted to be mounted as root or re-rendered. The XSS check is on, so perhaps this is just a component created without ["$$typeof"] = Symbol.for("react.element") ?`);
            }

            if(typeof newJSX.type === "string") {
                
                let seqId = nextSeqId++;
                let nodeTyped: RenderTreeChildLeaf = createdNode = {
                    type: "domNode",
                    jsxType: newJSX.type,
                    jsx: undefined,
                    childNode: document.createElement(newJSX.type),

                    key,
                    pendingVirtualDom: newJSX,

                    attachedToDOM: false,
                    tempNewIndex: 0,
                    tempPrevIndex: 0,
                    typeName: "",
                    

                    seqId,

                    prevSiblingNode: undefined,


                    component: parent.component,

                    parentTreeNode: parent,

                    context,
                    childTree: undefined,
                };
                let childJSX = newJSX.props.children;
                if(jsxHasOutput(childJSX)) {
                    nodeTyped.childTree = createDomChildrenTreeNode(context, childJSX, parent.component)
                }    
                setTypeName(nodeTyped);
            } else {
                if(typeof newJSX.type !== "function") {
                    throw new Error(`type must have typeof === "function" (classes have this, so this isn't a class or a function).`);
                }
                if(!("render" in newJSX.type.prototype)) {
                    if(typeof newJSX.key === "string" || typeof newJSX.key === "number") {
                        createdNode = {
                            type: "keyOnly",
                            key: String(newJSX.key),

                            pendingVirtualDom: newJSX,

                            attachedToDOM: false,
                            tempNewIndex: 0,
                            tempPrevIndex: 0,
                            typeName: "",
                            
                            seqId: nextSeqId++,
                            
                            prevSiblingNode: undefined,
                            
                            component: undefined,
                            parentTreeNode: parent,
                            context,
                            nested: [],

                            jsxWasFlattened: false
                        };

                        return createdNode;
                    }

                    throw new Error(`Invalid pure function mounted as root, or re-rendered. This is unsupported, only components should re-render.`);
                }

                let component = Object.assign(createComponent({
                    Class: newJSX.type as any,
                    props: newJSX.props,
                    parent: parent.component,
                }), {
                    [componentInstanceStateSymbol]: {
                        parentDomNode: parentNode,
                        parentComponent: parent.component,
                        treeNode: null as any
                    }
                });
                createdNode = {
                    type: "component",
                    componentType: newJSX.type.prototype.constructor.name,
                    component: component,
                    prevProps: newJSX.props,
                    jsx: undefined,
                    
                    nested: [],
    
                    key,
                    pendingVirtualDom: newJSX,

                    attachedToDOM: false,
                    tempNewIndex: 0,
                    tempPrevIndex: 0,
                    typeName: "",
                    
    
                    seqId: nextSeqId++,

                    prevSiblingNode: undefined,

                    parentTreeNode: parent,

                    context,

                    jsxWasFlattened: false
                };

                component[componentInstanceStateSymbol].treeNode = createdNode;
            }
            
        } else {
            debugger;
            if(isArray(newJSX)) {
                throw new Error(`Impossible, updateTreeNode should have expanded arrays`);
            }
            throw new Error(`Impossible, updateTreeNode should have expanded objects, had ${newJSX}`);
        }

        return createdNode;
    }
    function removeTreeNode(treeNode: RenderTreeChild): void {

        // Remove from DOM (recursively)
        if(treeNode.attachedToDOM) {
            detachTreeNodeFromDom(treeNode);
        }
        
        if(treeNode.type === "domNode") {
            if(!isPrimitive(treeNode.jsx)) {
                // Recurses through child nodes, so their call removeTreeNode, which calls the important onRemoveComponent callback.
                if(treeNode.childTree) {
                    treeNode.childTree.pendingVirtualDom = null;
                    mount2Tree(treeNode.childTree, treeNode.childNode);
                }
            }
            if(treeNode.jsx && typeof treeNode.jsx === "object") {
                let { props } = treeNode.jsx;
                for(let key in props) {
                    setPropertyWrapper(treeNode, key, props[key], undefined, true);
                }
            }
        } else {
            if(treeNode.type === "component") {
                onRemoveComponent(treeNode.component);
            }
            for(let nest of treeNode.nested) {
                removeTreeNode(nest);
            }
        }
    }
    
    // Expands components and fragments, until it gets to a real concrete change (a RenderTree leaf), and then adds
    //  that change/create/removal to the change lists.
    // Assumes the first treeNode and newJSX match. So... you should wrap them in a dummy jsx node and tree node to force them to match.
    function updateTreeNode(
        treeNode: RenderTreeChild
    ) {
        let newJSX = treeNode.pendingVirtualDom;
        treeNode.pendingVirtualDom = undefined;

        if(treeNode.type === "domNode") {
            // Make value and attribute changes, and queue nested changes, skipping this if our JSX is identical to before.
            //  This is good for JSX objects, as it allows the user to make large JSX objects and reuse them, which we can
            //  then detect and efficiently rerender the dom below them (by not rerendering or iterating over anything).

            if(treeNode.jsx === newJSX) {
                // Eh... this catches when non primitive JSX is that same too. Which... should be fine...
                return;
            }
            if(!isPrimitive(newJSX) && !("type" in newJSX)) {
                throw new Error(`Impossible, newJSX is invalid, it is not for a terminal node`);
            }
            let prevJSX = treeNode.jsx;
            treeNode.jsx = newJSX;

            if(isPrimitive(newJSX)) {
                let text = getText(newJSX);
                //console.log(`set value`, text, Date.now() % 10000);
                treeNode.childNode.nodeValue = text;
            } else {
                if(typeof prevJSX !== "object") {
                    prevJSX = null;
                }
                for(let key in newJSX.props) {
                    if(key === "children") continue;
                    let value = newJSX.props[key];
                    let oldValue = prevJSX && prevJSX.props[key] || undefined;
                    // style is an object, and they could very well mutate it, so we need to apply style always.
                    if(value === oldValue && key === "style") continue;
                    
                    setPropertyWrapper(treeNode, key, oldValue, value);
                }
                if(prevJSX) {
                    for(let key in prevJSX.props) {
                        if(newJSX.props.hasOwnProperty(key)) continue;
                        let value = newJSX.props[key];
                        let oldValue = prevJSX.props[key];
                        setPropertyWrapper(treeNode, key, oldValue, value);
                    }
                }

                let childJSX = newJSX.props.children;
                if(treeNode.childTree || jsxHasOutput(childJSX)) {
                    if(!treeNode.childTree) {
                        treeNode.childTree = createDomChildrenTreeNode(context, childJSX, treeNode.component);
                    }
                    treeNode.childTree.pendingVirtualDom = childJSX;
                    mount2Tree(treeNode.childTree, treeNode.childNode)
                }
            }
        }
        // Unwrap treeNode
        else if(treeNode.type === "component") {
            // Hmm... not sure the case for newJSX === undefined here? We don't call updateComponentProps, so what's the point of that?
            if(newJSX !== undefined) {
                if(isPrimitive(newJSX) || !("props" in newJSX)) {
                    debugger;
                    throw new Error(`Invalid match with tree node`);
                }

                if(!isShallowEqual(treeNode.prevProps, newJSX.props)) {
                    treeNode.prevProps = newJSX.props;
                    updateComponentProps(treeNode.component, newJSX.props);
                }
            }
            // Checked after updateComponentProps, as updating props can and likely will trigger the render to be triggered.
            if(!isFncTriggered(treeNode.component.render)) {
                // If it hasn't been triggered, we don't need to re-render the child, as it means the output
                //  will be the same as before.
                return;
            }
            // TODO: Delay render calls when there is a previous pending async render (but don't queue them, drop and throttle with tail calling).
            // TODO: Actually... I think the point of async renders is for the initial (server side) render. So... implement them with that
            //  in mind. Although... the server may still want to create a component once and then change it? In which case all of the renders should
            //  be connected to the callback of the forceUpdate/setState function, so the callback is only called when all child renders are called.
            //  But then again... that all just seems like so much work...
            newJSX = treeNode.component.render();

            reconcileTree(treeNode, newJSX);
        } else if(treeNode.type === "keyOnly") {
            if(newJSX === undefined) {
                throw new Error(`Keyed nodes should be given JSX from their parent.`);
            }

            if(!isPrimitive(newJSX) && "type" in newJSX && typeof newJSX.type === "function" && !("render" in newJSX.type.prototype)) {
                newJSX = newJSX.type(newJSX.props);
            } else {
                newJSX = newJSX;
            }

            reconcileTree(treeNode, newJSX);
        } else {
            throw new Error(`Unrecognized type ${(treeNode as any).type}`);
        }
    }
    
    function reconcileTree(
        treeNode: RenderTreeChild,
        newJSX: JSXNode | undefined
    ) {
        if(treeNode.type === "domNode") throw new Error(`Internal error, outer code filters this out.`);
        // TODO: Actually, order arrays in prevNestedLookup by size of nodes, and iterate on new nodes from largest to smallest.
        //  This allows for much better component rearrangement performance, allowing complex components that may be large or small
        //  to be moved around and correctly matched more frequently.

        // TODO: Perhaps add prop matching too, as if all the props are the same it is definitely the same node, and even if some
        //  are the same it is probably better to match it rather than the type being the same but all props changing.

        // TODO: We should add metrics here to detect the quality of our component matches. Something that tries more component matches,
        //  compares the resulting dom, and tells the user if our default match is significantly worse than the optimal match (which means
        //  the user should really add a key to force us to use the optimal match, or change their key, to be the optimal match instead
        //  of whatever they were doing before).



        // Do DOM changes here as well, using LongestSequence to be more efficient, or if delta is available
        //  just using that to be most efficient
        //  0) Update tree immediately.
        //  1) Remove nodes that have been removed
        //  1.5) Figure out which nodes just need to be changed, and not moved.
        //  2) Detach nodes that are being moved
        //  2.5) Recurse on nodes that are being moved, OR being changed
        //  3) Attach nodes that are being moved, low index to high index.
        //      - Which noops if we are in a child call and see our parent is detached
        //  4) Add new nodes


        let removedNodes: RenderTreeChild[] = [];
        let movedNested: RenderTreeChild[] = [];
        // May includes nodes in movedNested (and probably will include all nodes in movedNested)
        //  Will also include all nodes in newNested, however the two arrays makes sense, that way changes
        //  can be applied in order (if we removed the newNested nodes, the nested change calls would have to batch
        //  change and new calls separately.)
        let changedNested: RenderTreeChild[] = [];
        let newNested: RenderTreeChild[] = [];

        // flattenReconcilation updates .nested, and then populates the above change arrays, to indicate how the dom should
        //  be updated (and also which children should have a recursive updateTreeNode call).

        flattenReconcilation(newJSX);
        function flattenReconcilation(
            newJSX: JSXNode
        ): void {
            if(treeNode.type === "domNode") throw new Error(`Internal error, outer code filters this out.`);

            if(getDeltaFromArray()) {
                return;
            }
            function getDeltaFromArray() {
                if(treeNode.type === "domNode") throw new Error(`Internal error, outer code filters this out.`);

                if(treeNode.jsxWasFlattened) {
                    return;
                }
                if(!Array.isArray(newJSX)) {
                    return;
                }

                let newJSXTyped: ArrayDeltaObj<JSXNode> = newJSX;
                let deltaFnc = newJSXTyped[arrayDelta];
                if(deltaFnc) {
                    let deltaObj = deltaFnc();
                    // TODO: Handle flattening in our delta array code. This is difficult, and maybe require making a tree to keep
                    //  track of indexes, but... it is probably worth it, because only rerendering a delta (if it is provided) is
                    //  very efficient.

                    // Find cases where the newJSX requires flattening. We can't handle flattening in our delta array code.
                    for(let insertIndex of deltaObj.inserts) {
                        if(insertIndex < 0) insertIndex = ~insertIndex;
                        let newChildJSX = newJSX[insertIndex];
                        if(isPrimitive(newChildJSX)) {
                            // primitive
                        } else if("type" in newChildJSX && typeof newChildJSX.type === "function" && "render" in newChildJSX.type.prototype) {
                            // component
                        } else if("type" in newChildJSX && typeof newChildJSX.type === "string" && (!context.XSSComponentCheck || reactSymbol in newChildJSX)) {
                            // dom node
                        } else if("key" in newChildJSX && newChildJSX.key != null) {
                            // keyed node
                        } else {
                            treeNode.jsxWasFlattened = true;
                            return;
                        }
                    }
                

                    let arr = treeNode.nested;
                    let moveStack: (RenderTreeChild|undefined)[] = [];

                    for(let removeIndex of deltaObj.removes) {
                        if(removeIndex < 0) {
                            removeIndex = ~removeIndex;
                            moveStack.push(arr[removeIndex]);
                            // NOTE: We add to moveNested later, when we actually use it.
                        } else {
                            removedNodes.push(arr[removeIndex]);
                        }
                        arr.splice(removeIndex, 1);
                    }

                    for(let insertIndex of deltaObj.inserts) {
                        let insertNode;
                        if(insertIndex < 0) {
                            insertIndex = ~insertIndex;
                            let auxOrder = deltaObj.auxOrder.pop();
                            if(auxOrder === undefined) throw new Error(`The delta insertions uses more values than the auxOrder can provide. This means the delta is invalid.`)
                            insertNode = moveStack[auxOrder];
                            if(insertNode === undefined) {
                                throw new Error(`Child tree has been moved into two locations simultaneously. This isn't necessarily invalid, but we don't support it, and currently don't intentionally generate it, so it is likely a bug.`);
                            }
                            moveStack[auxOrder] = undefined;
                            // NOTE: We don't need to add to changeNested here! Because we aren't "matching" with a "compatible" node,
                            //  this is literally the same value, so it only needs to be moved, it doesn't need to be re-rendered.
                            movedNested.push(insertNode);
                        } else {
                            let newJSXChild = newJSX[insertIndex];
                            insertNode = createTreeNode(newJSXChild, treeNode);
                            newNested.push(insertNode);
                            changedNested.push(insertNode);
                        }
                        insertNode.prevSiblingNode = arr[insertIndex - 1];
                        let next = UnionUndefined(arr[insertIndex]);
                        if(next) {
                            next.prevSiblingNode = insertNode;
                        }
                        arr.splice(insertIndex, 0, insertNode);
                    }
                    if(deltaObj.auxOrder.length > 0) {
                        throw new Error(`Values specified as moved, but not used. This means the delta is invalid.`);
                    }

                    return true;
                }
            }


            let prevNestedLookup: Map<string, { list: RenderTreeChild[]; nextIndex: number; }> = new Map();
            let prevNested = new Set(treeNode.nested);
            let nextNested: Set<RenderTreeChild> = new Set();

            let prevIndex = 0;
            for(let nested of prevNested) {
                nested.tempPrevIndex = prevIndex++;
                let typeList = prevNestedLookup.get(nested.typeName);
                if(!typeList) {
                    typeList = { list: [], nextIndex: 0 };
                    prevNestedLookup.set(nested.typeName, typeList);
                }
                typeList.list.push(nested);
            }

            function takeTreeNode(typeName: string) {
                let typeList = prevNestedLookup.get(typeName);
                if(!typeList) {
                    return undefined;
                }
                return typeList.list[typeList.nextIndex++];
            }

            expandShells(newJSX, true);
            findDeltaFromExpanded();

            // Expands array, objects and unkeyed fragments, basically anything that is too meaningless to be given a node in the RenderTree.
            //  Also removes unneeded values, such as values where getText(jsx) === "".
            function expandShells(newJSX: JSXNode, isRootExpand: boolean, forcedKey?: string) {
                if(treeNode.type === "domNode") throw new Error(`Internal error, outer code filters this out.`);

                // If it is terminal get a typeName and try to match it with prevNestedLookup,
                //  making a node if we can't find a match.
                // Otherwise call iterateJSX on all parts.
                // And then... I guess if we match we call updateTreeNode recursively.
                // And if we don't... we should make a createTreeNode fnc and then call that (recursively)?

                let isPrimitiveValue = isPrimitive(newJSX);
                //let isPrimitiveValue = !(newJSX && (isArray(newJSX) || (newJSX as any)[ReactOverride.IsDefinitelyACreateElementAndNotAnXSSAttack]));
                if(isPrimitiveValue) {
                    newJSX = getText(newJSX);
                    if(newJSX === "") {
                        return;
                    }
                }

                let typeName: string;
                if(forcedKey !== undefined) {
                    typeName = "key__" + forcedKey;
                } else if(isArray(newJSX)) {
                    // Arrays
                    for(let newJSXChild of newJSX) {
                        expandShells(newJSXChild, false);
                    }
                    if(!isRootExpand) {
                        treeNode.jsxWasFlattened = true;
                    }
                    return;
                } else if(isPrimitive(newJSX)) {
                    typeName = "domNode__primitive";
                // TODO: We should check for key in another way, so it doesn't conflict with raw objects.
                } else if("key" in newJSX && newJSX.key != null) {
                    // TODO: If we don't match the key, but it isn't a component, we could try just matching the type.
                    //  As we do global DOM matching later this is only for efficiency state, or for matching elements
                    //  when they lose their key property? (which I guess should never happen, so we don't really need
                    //  to implement it like this).
                    typeName = "key__" + newJSX.key;
                } else if("type" in newJSX && (!context.XSSComponentCheck || reactSymbol in newJSX)) {
                    if(typeof newJSX.type === "string") {
                        typeName = "domNode__" + newJSX.type;
                    } else {
                        // TODO: Actually, it should be a raw object, with a key of type. We should just fall through to the raw object case...
                        if(typeof newJSX.type !== "function") throw new Error(`Invalid type, not a string or function`);
                        if(!("render" in newJSX.type.prototype)) {
                            // Pure component
                            let children = newJSX.type(newJSX.props);
                            expandShells(children, false);
                            treeNode.jsxWasFlattened = true;
                            return;
                        } else {
                            // TODO: Actually... this is dangerous, just because two classes have the same name
                            //  don't mean they are the same class!
                            typeName = "component__" + newJSX.type.name;
                        }
                    }
                } else {
                    // Must be a raw object
                    let keys = Object.keys(newJSX);
                    for(let key of keys) {
                        expandShells((newJSX as any)[key], false, key);
                    }
                    treeNode.jsxWasFlattened = true;
                    return;
                }

                
                let matchedNode = takeTreeNode(typeName);
                if(matchedNode) {
                    matchedNode.pendingVirtualDom = newJSX;
                } else {
                    matchedNode = createTreeNode(newJSX, treeNode);
                }
                nextNested.add(matchedNode);
            }

            function findDeltaFromExpanded() {
                if(treeNode.type === "domNode") throw new Error(`Internal error, outer code filters this out.`);


                // Removes
                for(let prev of prevNested) {
                    if(!nextNested.has(prev)) {
                        removedNodes.push(prev);
                    }
                }

                // Moves
                {
                    let newIndex = 0;
                    for(let next of nextNested) {
                        if(prevNested.has(next)) {
                            next.tempNewIndex = newIndex++;
                        }
                    }
        
                    let movedNestedArr = Array.from(prevNested).filter(x => nextNested.has(x));
               
                    if(movedNestedArr.length < 4) {
                        // TODO: Be more smart this, as this could be inefficient if our < 10 children are very large.
                        // TODO: Perhaps also add a hardcoded check (maybe in LongestSequence) for newIndexList already being
                        //  in order, in which case longestSequence = newIndexList, and otherSequence = [].
                        for(let moved of movedNestedArr) {
                            movedNested.push(moved);
                        }
                    } else {
                        let { otherSequence } = LongestSequence(movedNestedArr.map(x => x.tempNewIndex));
                        for(let i of otherSequence) {
                            movedNested.push(movedNestedArr[i]);
                        }
                    }
                }

                // Changes, update nested
                {
                    treeNode.nested = [];
                    let lastNext: RenderTreeChild|undefined = undefined;
                    for(let nextNode of nextNested) {
                        changedNested.push(nextNode);
                        treeNode.nested.push(nextNode)

                        nextNode.prevSiblingNode = lastNext;
                        lastNext = nextNode;
                    }
                }

                // Adds
                for(let next of nextNested) {
                    if(!prevNested.has(next)) {
                        newNested.push(next);
                    }
                }
            }
        }
        
        // 1) Remove nodes that have been removed
        for(let removedNode of removedNodes) {
            removeTreeNode(removedNode);
        }

        // 2) Detach nodes that are being moved
        for(let move of movedNested) {
            detachTreeNodeFromDom(move);
        }

        // 2.5) Update next nodes
        for(let next of changedNested) {
            updateTreeNode(next);
        }

        //  3) Attach nodes that are being moved, low index to high index.
        //      - Which noops if we are in a child call and see our parent is detached
        for(let move of movedNested) {
            attachTreeNodeToDom(parentNode, move);
        }

        //  4) Add new nodes
        for(let newNode of newNested) {
            attachTreeNodeToDom(parentNode, newNode);
        }
    }
}

// TODO: When running this in a loop we should keep track of some of the previous searches
//  for dom nodes to make searches for the tree node directly after faster.
/** Gets the last dom node in the given tree, OR, the first dom node before it.
 *      - So... .after(newNode) will insert a dom node after the given tree.
 *      - Also, only returns dom nodes that are attachedToDOM. */
function getTrailingDomNode(tree: RenderTreeChild|undefined): ChildNode|undefined {
    while(true) {
        if(!tree) return undefined;
        if(!tree.attachedToDOM) {
            tree = tree.prevSiblingNode;
            continue;
        }
        if(tree.type === "domNode") {
            return tree.childNode;
        }
        for(let i = tree.nested.length - 1; i >= 0; i--) {
            let child = getTrailingDomNode(tree.nested[i]);
            if(child) {
                return child;
            }
        }
        let prevSiblingNode = tree.prevSiblingNode;
        if(!prevSiblingNode) {
            tree = tree.parentTreeNode;
        } else {
            tree = prevSiblingNode;
        }
    }
}


function attachTreeNodeToDom(parentNode: ChildNode, tree: RenderTreeChild): void {
    if(tree.parentTreeNode && !tree.parentTreeNode.attachedToDOM) {
        // We can't attach if our parent isn't attached.
        return;
    }
    let prevDomNode = getTrailingDomNode(tree);
    attachRecurse(tree);
    function attachRecurse(tree: RenderTreeChild) {
        if(tree.attachedToDOM) throw new Error(`Internal error, tried to attach to dom twice.`);
        tree.attachedToDOM = true;
        if(tree.type !== "domNode") {
            for(let nested of tree.nested) {
                attachRecurse(nested);
            }
            return;
        }
        if(prevDomNode) {
            prevDomNode.after(tree.childNode);
        } else {
            parentNode.insertBefore(tree.childNode, parentNode.childNodes[0] || null);
        }
        prevDomNode = tree.childNode;
    }
}

function detachTreeNodeFromDom(tree: RenderTreeChild): void {
    detachRecurse(tree);
    function detachRecurse(tree: RenderTreeChild) {
        if(!tree.attachedToDOM) throw new Error(`Internal error, tried to deattach from dom twice.`);
        tree.attachedToDOM = false;
        if(tree.type !== "domNode") {
            for(let i = tree.nested.length - 1; i >= 0; i--) {
                detachRecurse(tree.nested[i]);
            }
            return;
        }
        tree.childNode.remove();
    }
}

function setTypeName(node: RenderTreeChild) {
    if(node.key != null) {
        node.typeName = "key__" + node.key;
    } else if(node.type === "domNode") {
        node.typeName = "domNode__" + node.jsxType;
    } else if(node.type === "component") {
        node.typeName = "component__" + node.componentType;
    } else { // keyOnly will have a key, so it should already be handled
        throw new Error(`Impossible`);
    }
}