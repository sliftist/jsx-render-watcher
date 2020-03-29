/** Copied directly out of query-sub, from src/sync/html/mount2.tsx */


import { UnionUndefined, isPrimitive, isArray } from "./lib/type";

/*
import { Node } from "../../build/ReactOverride";
import { setAccessor } from "./preact.dom";
import { LongestSequence } from "../../algorithms/longestSequence";
*/

import { insertIntoListMapped, binarySearchMapped, sort } from "./lib/algorithms";

import "./lib/listExtensions_g";
import { keyBy, isShallowEqual } from "./lib/misc";
import { LongestSequence } from "./lib/longestSequence";
import { setAccessor } from "./lib/preact-dom";

export const mountContextSymbol = Symbol("mountContextSymbol");
export const mountDepthSymbol = Symbol("mountDepthSymbol");
export const mountRenderTreeChildLeaf = Symbol("mountRenderTreeChildLeaf");
const recordOfMountsSymbol = Symbol("recordOfMounts");

const reactSymbol = Symbol.for("react.element");

export function CleanNode(childNode: ChildNode & DOMNodeExtraSymbols) {
    delete childNode[mountContextSymbol];
    delete childNode[mountDepthSymbol];
    delete childNode[mountRenderTreeChildLeaf];
    delete childNode[recordOfMountsSymbol];
}



interface DOMNodeExtraSymbols {
    [mountContextSymbol]?: MountContext;
    [mountDepthSymbol]?: number;
    [mountRenderTreeChildLeaf]?: RenderTreeChildLeaf;
    [recordOfMountsSymbol]?: RenderTreeChild;
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


export type ComponentInstance = {
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
            depth: number;
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
    
    async: boolean;
    pendingAsyncVirtualDom: JSXNode;
    // This is used in case this node is removed while we are async rendering. If true
    //  we know to give up on this async render.
    removed: boolean;

    seqId: number;

    // Needed to allow us to reason about nodes without iterating on them (as in, to insert before or after them)
    //*
    firstDomNode: ChildNode|null;
    lastDomNode: ChildNode|null;

    


    // Used to allow modifying a component that is one of many children, without have to iterate through
    //  all the children in order to find where the component's nodes should be inserted.
    prevSiblingNode: RenderTreeChild|null;

    // Used to figure out indexes
    nestedDomNodeCount: number;

    // Used to decide what order to iterate nodes on.
    depth: number;

    // If type === "component", this is just the component at this node. Otherwise, it is the component
    //  of nearest ancestor, or undefined if that doesn't exist.
    component: ComponentInstance|undefined;

    parentTreeNode: RenderTreeChild|undefined;

    context: MountContext;
};


type RenderTreeChildLeaf = RenderTreeChildBase & {
    type: "domNode";
    jsxType: string; // type if it is a DOMElement, otherwise just "primitive"
    jsx: JSXNodeLeaf;
    childNode: ChildNode & DOMNodeExtraSymbols;
};

type RenderTreeChildComponent = RenderTreeChildBase & {
    type: "component";
    componentType: string;
    component: ComponentInstance & ComponentInstanceState;
    prevProps: { [key: string]: unknown };

    jsx: JSXNode;

    nested: RenderTreeChild[];
};
type RenderTreeChildKeyOnly = RenderTreeChildBase & {
    type: "keyOnly";
    key: string;

    nested: RenderTreeChild[];
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






type RerenderContext = {
    rootJSX?: JSXNode;
    treeNodes: { [seqId: number]: RenderTreeChild };
    parentComponent: ComponentInstance|undefined;
}

export const componentInstanceStateSymbol = Symbol("componentInstanceStateSymbol");
export type ComponentInstanceState = {
    [componentInstanceStateSymbol]: {
        parentDomNode: ChildNode & DOMNodeExtraSymbols;
        parentComponent: ComponentInstance|undefined;
        treeNode: RenderTreeChild;
    }
};

export function mountRerender(
    component: (ComponentInstance & ComponentInstanceState),
    XSSComponentCheck: boolean
) {
    // TODO: If we ever want to do component sibling swaps we should accept an array of components to rerender
    //  (as multiple might be pending to rerender), but for now... we rerender components in isolation anyway,
    //  so there is no reason to batch them.

    let { parentDomNode, parentComponent, treeNode } = component[componentInstanceStateSymbol];
    let context = parentDomNode[mountContextSymbol];
    if(!context) {
        console.error(`Cannot rerender, no mount context found for dom node`);
        return;
    }

    // TODO: Actually... if multiple siblings are triggered this can be faster. HOWEVER, it is a bit tricky to detect this with
    //  a single priority number in SyncFunctions, so we would need to accept many components, and

    mount2Internal(
        parentDomNode,
        context,
        {
            parentComponent,
            treeNodes: { [treeNode.seqId]: treeNode }
        },
        XSSComponentCheck
    );
}


let initializeDomNodeDidRenderLog = false;
function initializeDomNode<T extends ChildNode>(
    domNode: T,
    parentNode: ChildNode & DOMNodeExtraSymbols,
    treeNode: RenderTreeChildLeaf
): T & DOMNodeExtraSymbols {
    return Object.assign(domNode, {
        [mountContextSymbol]: parentNode[mountContextSymbol],
        [mountDepthSymbol]: (parentNode[mountDepthSymbol] || 0) + 1,
        [mountRenderTreeChildLeaf]: treeNode
    });
}






// So...
//  We either remount:
//  1) At the top level, and then remount all of our children
//  2) At a component level, which is kind of in the middle
//  3) At a dom node level, which is at the leaves
// And possibly:
//  4) At an intermediate virtual node level, because there were so many nested fragments (but this is not needed,
//      and I have no plans to implement this ever).

// TODO: We should queue up all rerender calls of components, so we can evaluate them from root most to leaf most,
//  that way don't re-render a child, and then re-render the parent, which requires re-rendering the child again.

let nextSeqId = 1;

export interface MountContext<OurComponentType extends ComponentInstance = ComponentInstance> {
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

export function Mount2<ComponentType extends ComponentInstance>(
    parentNode: ChildNode & { [mountContextSymbol]?: MountContext<ComponentType> },
    isFncTriggered: (fnc: Function) => boolean,
    runRootCode: (code: () => void) => void,
    createComponent: CreateComponent<ComponentType>,
    updateComponentProps: UpdateComponentProps<ComponentType>,
    onRemoveComponent: OnRemoveComponent<ComponentType>,
    remountContext: RerenderContext,
    XSSComponentCheck: boolean,
    addFncPropCallback: AddFncPropCallback = (id, fnc) => wrapWithRootCodeFnc(fnc, runRootCode),
    changedFncPropCallback: ChangedFncPropCallback = (id, fnc) => wrapWithRootCodeFnc(fnc, runRootCode),
    removeFncPropCallback: RemoveFncPropCallback = () => {},
): void {
    let context = parentNode[mountContextSymbol];
    if(!context) {
        context = parentNode[mountContextSymbol] = {
            isFncTriggered,
            createComponent,
            updateComponentProps,
            onRemoveComponent,
            runRootCode,
            addFncPropCallback,
            changedFncPropCallback,
            removeFncPropCallback,
        };
    } else {
        if(context.createComponent !== createComponent
        || context.updateComponentProps !== updateComponentProps
        || context.onRemoveComponent !== onRemoveComponent) {
            throw new Error(`We already mounted on this dom element, but with different callback functions. This isn't going to work...`);
        }
    }

    mount2Internal(
        parentNode as ChildNode & DOMNodeExtraSymbols,
        context as any as MountContext<ComponentInstance>,
        remountContext,
        XSSComponentCheck
    );
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


// This is called recursively on dom nodes, and handles all the intermediate structure (arrays, objects, fragments, components),
//  that don't actually emit dom nodes. It stores some state in the dom node, that way the caller doesn't need to store a tree
//  with rerender information.
export function mount2Internal(
    parentNode: ChildNode & DOMNodeExtraSymbols,
    context: MountContext,
    remountContext: RerenderContext,
    /** If true, elements are only recognized when they have a property called: ["$$typeof"], equal to Symbol.for("react.element"). Otherwise they are rendered
     *      as objects are (the key being the fragment key, the property being a value, the result always being text nodes, and never elements).
     */
    XSSComponentCheck: boolean
): void {
    // Steps:
    //  1) Update RenderTreeChild for all children (recursively) of all nodes that requested to be changed.
    //      - Take existing domNodes where we can, make pendingDomNodes otherwise, record domNodes (remove unused
    //          tree nodes from the tree).
    //      - Output the order we iterate on, which is the order the domNodes should appear in the dom
    //      - Don't iterate on any async renders, unless they were explicitly triggered
    //      - Create new dom nodes and apply prop changes
    //  2) Delete all unused nodes
    //  3) Order all existing domNodes based on the order outputted from the update RenderTreeChild step
    //  4) Add new nodes
    //  5) Take the children property of the jsx of all the elements we created and call Mount2 with that property as the new
    //      jsx property, and the element as the parent.


    // TODO: Add delayed node creation so we can do "global" (to our dom children at least) component matching. To do
    //  this we need to flatten treeNodeTransformations, which requires adding very careful code (which requires looking
    //  at nested a lot) to iterate over the parents of these transformed tree nodes to try combine? (not just flatten,
    //  we might be able to combine two siblings for benefit with combining all of them) the root changed nodes.
    //  This requires finding their absolute dom index (within our parent), which requires iterating over all siblings
    //  of our ancestors, which we want to avoid if we are only moving 2 dom nodes, and are part of a list of 100,000,
    //  but which we want to do if we invalidated two component whose have child components that we want to swap.


    //mark("mount2_nothing");
    //mark("mount2_nothing", true);

    //mark("mount2_setup");



    let { isFncTriggered, createComponent, updateComponentProps, onRemoveComponent } = context;

    let parentNodeTyped = Object.assign(parentNode, {
        [mountContextSymbol]: context,
        [mountDepthSymbol]: parentNode[mountDepthSymbol] || 0
    });

    let document = parentNode.ownerDocument as Document;

    //.todonext;
    // Dedupe childrenToRemount, with respect to tree hierarchy, so that if a parent and child triggers, we only
    //  actually trigger the parent change...
    let childrenToRemount: RenderTreeChild[];
    let treeNodesForceUpdated: { [seqId: number]: true } = {};

    //console.log(`mount at depth ${parentNodeTyped[mountDepthSymbol]}`);

    let rootRenderTree: RenderTreeChild|undefined = parentNode[recordOfMountsSymbol];
    if(!("rootJSX" in remountContext)) {
        if(!(rootRenderTree)) {
            throw new Error(`Cannot remount specific for the first render! Either the dom node was changed outside of our environment (wiping out our previous data), or this function was called incorrectly.`);
        }
        childrenToRemount = Object.values(remountContext.treeNodes);
        for(let child of childrenToRemount) {
            treeNodesForceUpdated[child.seqId] = true;
        }
    } else {
        if(rootRenderTree) {
            if(rootRenderTree.type !== "keyOnly" || !rootRenderTree.async) {
                throw new Error(`Expect root render tree to have a type of keyOnly, and be async.`);
            }
            
            rootRenderTree.pendingAsyncVirtualDom = { key: "root", props: { children: remountContext.rootJSX } };
        } else {
            // Create dom nodes to represent the existing state, so we can reuse it.
            //  (this is required, as we might want to remount with existing siblings, or we might
            //  want to remount from server generated dom, although in that case we can probably just
            //  send the server generated RecordOfMounts too...)

            // TODO: Allow the user to input specific nodes, letting us mount next to existing siblings and not remove them.
            childrenToRemount = [];

            let nestedChildNodes: RenderTreeChild[] = [];
            let { childNodes } = parentNode;
            let prevSiblingNode: RenderTreeChild|null = null;
            for(let i = 0; i < childNodes.length; i++) {
                let childNode = childNodes[i];
                let treeNode: RenderTreeChild = {
                    type: "domNode",
                    jsxType: childNode.nodeType === 1 /* Node.ELEMENT_NODE */ ? (childNode as HTMLElement).tagName : "primitive",
                    jsx: createJSXFromNode(childNode),

                    async: false,
                    pendingAsyncVirtualDom: undefined,
                    removed: false,
                    key: null,
                    seqId: nextSeqId++,
                    depth: 1,
                    childNode: undefined as any,
                    nestedDomNodeCount: 1,
                    firstDomNode: childNode,
                    lastDomNode: childNode,
                    prevSiblingNode: prevSiblingNode,
                    component: remountContext.parentComponent,

                    parentTreeNode: parentNode[mountRenderTreeChildLeaf],

                    context
                };
                treeNode.childNode = initializeDomNode(childNode, parentNodeTyped, treeNode);
                
                nestedChildNodes.push(treeNode);
                prevSiblingNode = treeNode;
            }

            rootRenderTree = parentNode[recordOfMountsSymbol] = {
                key: "root",
                // keyOnly, just because we only support a few types, and we don't support any "raw, but no key" type, because...
                //  usually the only reason for raw nodes is to apply keys...
                type: "keyOnly",
                // I forget why this needs to be async. I think it is because our synced components
                //  trigger renders themselves... which works. So I guess this code won't work for rerenders
                //  of non-synced components ever?
                async: true,
                // Must have a key that matches with the key of our tree node.
                //  (this is unwrapped specially, with the special keyOnly handling).
                pendingAsyncVirtualDom: { key: "root", props: { children: remountContext.rootJSX } },
                removed: false,
                nested: nestedChildNodes,
                seqId: nextSeqId++,
                depth: 0,
                firstDomNode: null,
                lastDomNode: null,
                nestedDomNodeCount: 0,
                prevSiblingNode: null,
                component: remountContext.parentComponent,

                parentTreeNode: parentNode[mountRenderTreeChildLeaf],

                context
            };

            let nested = rootRenderTree.nested;
            rootRenderTree.firstDomNode = null;
            for(let i = 0; i < nested.length; i++) {
                let nest = nested[i];
                if(nest.firstDomNode) {
                    rootRenderTree.firstDomNode = nest.firstDomNode;
                    break;
                }
            }

            rootRenderTree.lastDomNode = null;
            for(let i = nested.length - 1; i >= 0; i--) {
                let nest = nested[i];
                if(nest.lastDomNode) {
                    rootRenderTree.lastDomNode = nest.lastDomNode;
                    break;
                }
            }

            rootRenderTree.nestedDomNodeCount = 0;
            for(let nested of rootRenderTree.nested) {
                rootRenderTree.nestedDomNodeCount += nested.nestedDomNodeCount;
            }
        }
        childrenToRemount = [rootRenderTree];

        treeNodesForceUpdated[rootRenderTree.seqId] = true;
        for(let key in remountContext.treeNodes) {
            treeNodesForceUpdated[key] = true;
        }
    }


    //todonext;
    // Break this internal remount off into another function, that takes a single RenderTreeChild as an argument.


    type TreeNodeTransformations = {
        rootNode: RenderTreeChild;
        changes: {
            node: RenderTreeChild;
            originalIndex: number|undefined;
            newIndex: number|undefined;
        }[];
    };

    let treeNodeTransformations: {
        [seqId: number]: TreeNodeTransformations;
    } = {};
    let curTreeNodeTransformation: TreeNodeTransformations;

    let treeNodesUpdated: { [seqId: number]: true } = {};

    // All the nodes with child dom nodes (so the nodes we have to iterate further on) (that have changed, been added, or been removed).
    let addedOrMovedNestedTreeLeafs: RenderTreeChildLeaf[] = [];
    let removedNestedTreeLeafs: RenderTreeChildLeaf[] = [];

    //mark("mount2_setup", true);
    

    // TODO: Support global component (and maybe dom node) reuse. This requires delaying object creation until after the tree
    //  loop, and calculating newIndex differently.

    // NOTE: We iterate forwards instead of backwards (as backwards works well with insertBefore, but forward requires nextSibling),
    //  to make it so that when we support stopping iteration and async rendering the remaining items we will have rendered the first part
    //  of the page (iterating backwards would mean stopping at any point will leave only the last part of the page rendered). And the first
    //  part is preferrable to the last part, as the first part is more likely to be seen, and have important information, then the last part.

    function getText(jsx: unknown): string {
        let text = "";
        if(jsx == null || jsx === false || jsx === true) {
            text = "";
        } else {
            text = String(jsx);
        }
        return text;
    }

    // Only called for components, or domNodes (which are always terminal)
    function createTreeNode(
        newJSX: JSXNode,
        parent: RenderTreeChild,
        newIndexStart: number,
        prevSiblingNode: RenderTreeChild|null,
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
            let nodeTyped = createdNode = {
                type: "domNode",
                jsxType: "primitive",
                jsx: newJSX,
                childNode: undefined as any,

                key: null,
                async: false,
                pendingAsyncVirtualDom: undefined,
                removed: false,

                seqId,
                depth: parent.depth + 1,

                firstDomNode: undefined as any,
                lastDomNode: undefined as any,

                nestedDomNodeCount: 1,

                prevSiblingNode: prevSiblingNode,

                component: parent.component,

                parentTreeNode: parent,

                context
            };
            let childNode = initializeDomNode(document.createTextNode(text), parentNodeTyped, nodeTyped);
            nodeTyped.childNode = nodeTyped.firstDomNode = nodeTyped.lastDomNode = childNode;

            curTreeNodeTransformation.changes.push({
                node: nodeTyped,
                newIndex: newIndexStart,
                originalIndex: undefined
            });
        } else if("type" in newJSX) {
            let key = newJSX.key != null ? String(newJSX.key) : null;

            if(XSSComponentCheck && !(reactSymbol in newJSX)) {
                throw new Error(`Object which looked like XSS attempted to be mounted as root or re-rendered. The XSS check is on, so perhaps this is just a component created without ["$$typeof"] = Symbol.for("react.element") ?`);
            }

            if(typeof newJSX.type === "string") {
                
                let seqId = nextSeqId++;
                let nodeTyped = createdNode = {
                    type: "domNode",
                    jsxType: newJSX.type,
                    jsx: newJSX,
                    childNode: undefined as any,

                    key,
                    async: false,
                    pendingAsyncVirtualDom: undefined,
                    removed: false,

                    seqId,
                    depth: parent.depth + 1,

                    prevSiblingNode,

                    nestedDomNodeCount: 1,

                    firstDomNode: undefined as any,
                    lastDomNode: undefined as any,

                    component: parent.component,

                    parentTreeNode: parent,

                    context
                };
                let childNode = initializeDomNode(document.createElement(newJSX.type), parentNodeTyped, nodeTyped);
                nodeTyped.childNode = nodeTyped.firstDomNode = nodeTyped.lastDomNode = childNode;

                curTreeNodeTransformation.changes.push({
                    node: nodeTyped,
                    newIndex: newIndexStart,
                    originalIndex: undefined
                });

                for(let key in newJSX.props) {
                    if(key === "children") continue;
                    let value = newJSX.props[key];
                    let oldValue = undefined;
                    if(value === oldValue) {
                        continue;
                    }
                    setPropertyWrapper(nodeTyped, key, oldValue, value);
                }

                addedOrMovedNestedTreeLeafs.push(nodeTyped);
            } else {
                if(typeof newJSX.type !== "function") {
                    throw new Error(`type must have typeof === "function" (classes have this, so this isn't a class or a function).`);
                }
                if(!("render" in newJSX.type.prototype)) {
                    if(typeof newJSX.key === "string" || typeof newJSX.key === "number") {
                        createdNode = {
                            type: "keyOnly",
                            key: String(newJSX.key),

                            async: false,
                            pendingAsyncVirtualDom: undefined,
                            removed: false,
                            seqId: nextSeqId++,
                            firstDomNode: null,
                            lastDomNode: null,
                            prevSiblingNode: prevSiblingNode,
                            nestedDomNodeCount: 0,
                            depth: parent.depth + 1,
                            component: undefined,
                            parentTreeNode: parent,
                            context,
                            nested: [],
                        };

                        // This populates createdNode.nested, nestedDomNodeCount, firstDomNode and lastDomNode
                        updateTreeNode(createdNode, newJSX, undefined, newIndexStart);
                        return createdNode;
                    }

                    throw new Error(`Invalid pure function mounted as root, or re-rendered. This is unsupported, only components should re-render.`);
                }

                let component = Object.assign(createComponent({
                    Class: newJSX.type as any,
                    props: newJSX.props,
                    parent: parent.component,
                    depth: parent.depth + 1,
                }), {
                    [componentInstanceStateSymbol]: {
                        parentDomNode: parentNodeTyped,
                        parentComponent: parent.component,
                        treeNode: null as any
                    }
                });
                createdNode = {
                    type: "component",
                    componentType: newJSX.type.prototype.constructor.name,
                    component: component,
                    prevProps: newJSX.props,
                    jsx: newJSX,
                    
                    nested: [],
    
                    key,
                    async: false,
                    pendingAsyncVirtualDom: undefined,
                    removed: false,
    
                    seqId: nextSeqId++,
                    depth: parent.depth + 1,

                    nestedDomNodeCount: 0,

                    prevSiblingNode: prevSiblingNode,

                    firstDomNode: null,
                    lastDomNode: null,

                    parentTreeNode: parent,

                    context
                };

                component[componentInstanceStateSymbol].treeNode = createdNode;

                // This populates createdNode.nested, nestedDomNodeCount, firstDomNode and lastDomNode
                updateTreeNode(createdNode, undefined, undefined, newIndexStart);
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
    function removeTreeNode(treeNode: RenderTreeChild, originalIndexStart: number): void {
        if(treeNode.seqId in treeNodesUpdated) {
            throw new Error(`Tried to remove node we either already removed, or already accessed?`);
        }
        // Update treeNodesUpdated, even for removed nodes, so we don't start updating zombie nodes.
        //  (treeNodesUpdated is just a graph deduper).
        treeNodesUpdated[treeNode.seqId] = true;
        treeNode.removed = true;

        // Iterate on all children, with the goal of getting leaf nodes to add to removedDomTreeNodes
        if(treeNode.type === "domNode") {
            if(!isPrimitive(treeNode.jsx)) {
                removedNestedTreeLeafs.push(treeNode);
            }
            curTreeNodeTransformation.changes.push({
                node: treeNode,
                originalIndex: originalIndexStart,
                newIndex: undefined,
            });
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
            let originalIndexCur = originalIndexStart;
            for(let nest of treeNode.nested) {
                removeTreeNode(nest, originalIndexCur);
                originalIndexCur += nest.nestedDomNodeCount;
            }
        }
    }
    
    // Expands components and fragments, until it gets to a real concrete change (a RenderTree leaf), and then adds
    //  that change/create/removal to the change lists.
    // Assumes the first treeNode and newJSX match. So... you should wrap them in a dummy jsx node and tree node to force them to match.
    function updateTreeNode(
        treeNode: RenderTreeChild,
        newJSX: JSXNode | undefined,
        originalIndexStart: number|undefined,
        newIndexStart: number,
    ) {
        if(treeNode.seqId in treeNodesUpdated) {
            return;
        }
        // Update treeNodesUpdated, even for removed nodes, so we don't start updating zombie nodes.
        treeNodesUpdated[treeNode.seqId] = true;

        if(treeNode.async) {
            if(!(treeNode.seqId in treeNodesForceUpdated)) {
                treeNode.pendingAsyncVirtualDom = newJSX;
                curTreeNodeTransformation.changes.push({
                    node: treeNode,
                    newIndex: newIndexStart,
                    originalIndex: originalIndexStart,
                });
                return;
            }
        }

        if(treeNode.type === "domNode") {
            curTreeNodeTransformation.changes.push({
                node: treeNode,
                newIndex: newIndexStart,
                originalIndex: originalIndexStart,
            });

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
                // We wouldn't get matched by our parent if the prevJSX wasn't also a primitive,
                if(isPrimitive(prevJSX)) {
                    throw new Error(`Impossible`);
                }

                for(let key in newJSX.props) {
                    if(key === "children") continue;
                    let value = newJSX.props[key];
                    let oldValue = prevJSX.props[key];
                    // style is an object, and they could very well mutate it, so we need to apply style always.
                    if(value === oldValue && key === "style") continue;
                    
                    setPropertyWrapper(treeNode, key, oldValue, value);
                }
                for(let key in prevJSX.props) {
                    if(newJSX.props.hasOwnProperty(key)) continue;
                    let value = newJSX.props[key];
                    let oldValue = prevJSX.props[key];
                    setPropertyWrapper(treeNode, key, oldValue, value);
                }

                addedOrMovedNestedTreeLeafs.push(treeNode);
            }

            // domNodes are always terminal nodes
            return;
        }
        // Unwrap treeNode
        if(treeNode.type === "component") {
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
            /*
            if(newJSX instanceof Promise) {
                newJSX.then(() => {
                    context.runRootCode(() => {
                        mountRerender(treeNode.component, XSSComponentCheck);
                    });
                }, error => {
                    console.error(`Error in async render, trying to render again anyway`, error);
                    context.runRootCode(() => {
                        // Mount it, so the error can be thrown synchronously (or not thrown at all)
                        mountRerender(treeNode.component, XSSComponentCheck);
                    });
                });
                return;
            }
            */
        } else if(treeNode.type === "keyOnly") {
            if(newJSX === undefined) {
                throw new Error(`Keyed nodes should be given JSX from their parent.`);
            }

            if(isPrimitive(newJSX) || !("key" in newJSX) || newJSX.key == null) {
                throw new Error(`Matched jsx without key, with keyOnly tree node. This means we are trying to stick non-keyed jsx into a key-ed tree node, which is impossible.`);
            }

            // Unwrap the key wrapper, or else no one ever will
            //forcedKey = String(newJSX.key);
            if(typeof newJSX.type === "function" && !("render" in newJSX.type.prototype)) {
                newJSX = newJSX.type(newJSX.props);
            } else {
                newJSX = newJSX.props.children;
            }
        } else {
            throw new Error(`Unrecognized type ${(treeNode as any).type}`);
        }

        updateTreeNodeInternal(treeNode, newJSX, originalIndexStart, newIndexStart);
    }
    function updateTreeNodeInternal(
        treeNode: RenderTreeChild,
        newJSX: JSXNode | undefined,
        originalIndexStart: number|undefined,
        newIndexStart: number,
    ) {
        if(treeNode.type === "domNode") throw new Error(`Outer code filters this out.`);
        // TODO: Actually, order arrays in prevNestedLookup by size of nodes, and iterate on new nodes from largest to smallest.
        //  This allows for much better component rearrangement performance, allowing complex components that may be large or small
        //  to be moved around and correctly matched more frequently.

        // TODO: Perhaps add prop matching too, as if all the props are the same it is definitely the same node, and even if some
        //  are the same it is probably better to match it rather than the type being the same but all props changing.

        // TODO: We should add metrics here to detect the quality of our component matches. Something that tries more component matches,
        //  compares the resulting dom, and tells the user if our default match is significantly worse than the optimal match (which means
        //  the user should really add a key to force us to use the optimal match, or change their key, to be the optimal match instead
        //  of whatever they were doing before).

        let originalIndexes: Map<number, number>|undefined;

        if(originalIndexStart === undefined && treeNode.nested.length > 0) {
            throw new Error(`Impossible. We are freshly creating the node, but it already has nested values?`);
        }

        if(originalIndexStart !== undefined) {
            originalIndexes = new Map();
            let originalCurIndex = originalIndexStart;
            for(let nest of treeNode.nested) {
                originalIndexes.set(nest.seqId, originalCurIndex);
                originalCurIndex += nest.nestedDomNodeCount;
            }
        }

        let prevNestedLookup: {
            [typeName: string]: RenderTreeChild[]
        } = {};
        let prevNested = treeNode.nested;
        treeNode.nested = [];
        for(let i = 0; i < prevNested.length; i++) {
            let nested = prevNested[i];
            let typeName: string;
            if(nested.key != null) {
                typeName = "key__" + nested.key;
            } else if(nested.type === "domNode") {
                typeName = "domNode__" + nested.jsxType;
            } else if(nested.type === "component") {
                typeName = "component__" + nested.componentType;
            } else { // keyOnly will have a key, so it should already be handled
                throw new Error(`Impossible`);
            }
            if(!(typeName in prevNestedLookup)) {
                prevNestedLookup[typeName] = [];
            }
            prevNestedLookup[typeName].push(nested);
        }

        function takeTreeNode(typeName: string) {
            if(!(typeName in prevNestedLookup)) {
                return undefined;
            }
            let list = prevNestedLookup[typeName];
            let result = list.shift();
            if(list.length === 0) {
                delete prevNestedLookup[typeName];
            }
            return result;
        }

        // TODO: Somewhere around here decide when things should asyncRender, and create an asyncRender holder
        //  instead of a keyed/component/domNode holder. And then also, on re-renders, try to preserve that
        //  asyncRender state, making sure the same thing (which is hard to tell and requires some guesses in mapping)
        //  asyncRenders again.
        // TODO: Even easier then figure out how to turn on async renders, allow the user to decide when to, and then
        //  do key based matching on async renders, to preserve async across renders.

        // These may not be leaf nodes, but they have changed
        let usedNodesIds: Set<number> = new Set();

        let newNested: {
            newJSX: JSXNode;
            matchedNode: RenderTreeChild|undefined;
        }[] = [];

        // Expands array, objects and unkeyed fragments, basically anything that is too meaningless to be given a node in the RenderTree.
        //  Also removes unneeded values, such as values where getText(jsx) === "".
        function expandShells(newJSX: JSXNode, forcedKey?: string) {
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
                    expandShells(newJSXChild);
                }
                return;
            } else if(isPrimitive(newJSX)) {
                typeName = "domNode__primitive";
            } else if("key" in newJSX && newJSX.key != null) {
                // TODO: If we don't match the key, but it isn't a component, we could try just matching the type.
                //  As we do global DOM matching later this is only for efficiency state, or for matching elements
                //  when they lose their key property? (which I guess should never happen, so we don't really need
                //  to implement it like this).
                typeName = "key__" + newJSX.key;
            } else if("type" in newJSX && (!XSSComponentCheck || reactSymbol in newJSX)) {
                if(typeof newJSX.type === "string") {
                    typeName = "domNode__" + newJSX.type;
                } else {
                    if(typeof newJSX.type !== "function") throw new Error(`Invalid type, not a string or function`);
                    if(!("render" in newJSX.type.prototype)) {
                        // Pure component
                        let children = newJSX.type(newJSX.props);
                        expandShells(children);
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
                    expandShells((newJSX as any)[key], key);
                }
                return;
            }

            let matchedNode = takeTreeNode(typeName);
            if(matchedNode) {
                newNested.push({
                    newJSX,
                    matchedNode,
                });
                usedNodesIds.add(matchedNode.seqId);
            } else {
                newNested.push({
                    newJSX,
                    matchedNode: undefined,
                });
            }
        }

        expandShells(newJSX);


        {
            let prevSiblingNode: RenderTreeChild|null = treeNode.prevSiblingNode;
            
            let newCurIndex = newIndexStart;
            for(let i = 0; i < newNested.length; i++) {
                let { matchedNode, newJSX } = newNested[i];
                if(matchedNode) {
                    matchedNode.prevSiblingNode = prevSiblingNode;
                    updateTreeNode(
                        matchedNode,
                        newJSX,
                        originalIndexes ? originalIndexes.get(matchedNode.seqId) : undefined,
                        newCurIndex,
                    );
                } else {
                    matchedNode = createTreeNode(newJSX, treeNode, newCurIndex, prevSiblingNode);
                }
                prevSiblingNode = matchedNode;
                newCurIndex += matchedNode.nestedDomNodeCount;
                treeNode.nested.push(matchedNode);
            }
        }

        // Update first/last dom nodes. This is kind of broken, as we should be doing this after we actually move around our
        //  nodes... but it works presently because our move should never be looking at these firstDomNode/lastDomNode values?
        {
            let nested = treeNode.nested;
            treeNode.firstDomNode = null;
            for(let i = 0; i < nested.length; i++) {
                let nest = nested[i];
                if(nest.firstDomNode) {
                    treeNode.firstDomNode = nest.firstDomNode;
                    break;
                }
            }

            treeNode.lastDomNode = null;
            for(let i = nested.length - 1; i >= 0; i--) {
                let nest = nested[i];
                if(nest.lastDomNode) {
                    treeNode.lastDomNode = nest.lastDomNode;
                    break;
                }
            }
        }

        treeNode.nestedDomNodeCount = 0;
        for(let nested of treeNode.nested) {
            treeNode.nestedDomNodeCount += nested.nestedDomNodeCount;
        }


        if(originalIndexes) {
            for(let prevNest of prevNested) {
                if(!usedNodesIds.has(prevNest.seqId)) {
                    removeTreeNode(prevNest, originalIndexes.get(prevNest.seqId) || 0);
                }
            }
        }
    }

    //todonext;
    // Actually... just have updateTreeNode take the transformations as a parameter, and then apply them within the loop,
    //  moving everything within the loop as well...

    sort(childrenToRemount, x => x.depth);
    for(let childToRemount of childrenToRemount) {
        if(childToRemount.seqId in treeNodesUpdated) continue;
        curTreeNodeTransformation = {
            rootNode: childToRemount,
            changes: [],
        };
        treeNodeTransformations[childToRemount.seqId] = curTreeNodeTransformation;
        // originalIndexStart and newIndexStart don't need to be global, as we deal with nodes in isolation anyway.
        updateTreeNode(childToRemount, childToRemount.pendingAsyncVirtualDom, 0, 0);
    }

    //mark("mount2_tree", true);


    //mark("mount2_transform");

    // The tree is correct. We need to deal with old dom deletion, dom ordering, dom insertion, and rendering children of rendered dom elements.

    for(let key in treeNodeTransformations) {
        let { changes } = treeNodeTransformations[key];
        // Our iteration order should ensure there are no overlaps in these transformations, so we can run them in isolation.

        function getDomNodes(node: RenderTreeChild): ChildNode[] {
            let domNodes: ChildNode[] = [];
            getDomNodesInternal(node, domNodes);
            return domNodes;
            function getDomNodesInternal(node: RenderTreeChild, arrayOutput: ChildNode[]): void {
                if(node.type === "domNode") {
                    arrayOutput.push(node.childNode);
                } else {
                    for(let nest of node.nested) {
                        getDomNodesInternal(nest, arrayOutput);
                    }
                }
            }
        }

        //  2) Delete all unused nodes
        let deletions = changes.filter(x => x.newIndex === undefined);
        for(let deleteChange of deletions) {
            let nodesToDelete = getDomNodes(deleteChange.node);
            for(let i = 0; i < nodesToDelete.length; i++) {
                let node = nodesToDelete[i];
                parentNode.removeChild(node);
            }
        }

        let insertions = changes.filter(x => x.originalIndex === undefined) as {
            node: RenderTreeChild;
            newIndex: number;
        }[];
        let moves = changes.filter(x => x.newIndex !== undefined && x.originalIndex !== undefined) as {
            node: RenderTreeChild;
            originalIndex: number;
            newIndex: number;
        }[];


        for(let i = 0; i < moves.length - 1; i++) {
            if(moves[i].newIndex >= moves[i + 1].newIndex) {
                throw new Error(`Impossible, changes should be ordered by newIndex`);
            }
        }

        //  3) Order all existing domNodes based on the order outputted from the update RenderTreeChild step
        // Moves
        let currentOrder: {
            newIndex: number;
            node: RenderTreeChild;
        }[] = [];
        function insertNode(change: { newIndex: number; node: RenderTreeChild; }) {
            
            let nodesInMove = getDomNodes(change.node);

            let insertIndex = binarySearchMapped(currentOrder, change.newIndex, x => x.newIndex, (a, b) => a - b);
            if(insertIndex < 0) {
                insertIndex = ~insertIndex;
            }
            if(insertIndex === currentOrder.length) {
                currentOrder.push(change);
                for(let nodeToInsert of nodesInMove) {
                    parentNode.appendChild(nodeToInsert);
                }
            } else {
                /*
                todonext;
                // Not correct with sparse changes. It may be the case that node before us in currentOrder is not the node before us in
                //  the dom (the ones between may not have been changed), so should look before and after, using an array
                //  of our siblings (which we aren't already using? Maybe it doesn't exist? Although it should...)
                //  using their firstDomNode/lastDomNode property? Which... reference the prev/next if the node has no dom nodes?
                todonext;
                // There was uncertainty about firstDomNode/lastDomNode being updated correctly. So we should check on that,
                //  because we are really going to need those now...
                todonext;
                // So... we should take the virtual tree child array (which again, MUST exist somehow?) and then remove all elements
                //  that are going to be moved (which might be all elements, we can add a TODO to make the array mutations more
                //  efficient if a high enough fraction is moved, by remaking the entire array). Then... update the dom first/last
                //  (which are really prev/next when there are no dom nodes) of any elements which stay WHICH are siblings of elements
                //  that are moved (we can probably update it when we "remove" elements).
                todonext;
                // Hmm... but as we insert, maintaining first/last will be inefficient... There is no way around it, even one insertion
                //  could require iterating over every element! Fuck....

                todonext;
                // Okay... maybe reduce firstDomNode/lastDomNode to just... lastDomNode?

                todonext;
                // Okay, so use after() instead of insertBefore
                //  Remove all mutated values from the virtual dom, and then insert all moved values back in.
                //  - But pretend the longest sequence is non-mutated
                //      - HOWEVER this sequence needs to be consecutive in terms of mutations... which... is hard to explain,
                //          but basically, if the range (from min to max) of the sequence in prevIndex AND newIndex order is taken,
                //          all the elements need to be mutated. LongestSequence can detect this... but... I'm not sure if this detection
                //          can be put into the actual algorithm?
                //          - ALTHOUGH hmm... this is TOO strict, as gaps might still be okay...

                todonext
                // OH! ACTUALLY! We might want to rearranging non-mutated elements, sometimes, as sometimes that will be more efficient!
                //  Ugh... maybe... we just leave our LongestSequence code for when all children are mutated (or all mutations are in order),
                //  and then when using an array delta just leave it up the creator of the delta to be efficient.

                todonext;
                // Actually... we only need firstDomNode/last to exist within nested, not across the whole tree, as while we HAVE to support
                //  large sibling count, large depth is allowed to scale at O(N).
                //  And then... THIS makes things easier. It means... we could probably create a proper tree...

                todonext;
                // Okay, then... we just do dom deletions, then insertions in order of final index?
                //  Oh, right, if we do it in final index order, then it becomes inefficient when an element is moved
                //  from the start to the end.
                todonext;
                // Ugh... it keeps seeming like we will want a tree. But I really don't want to have to create a tree...
                // Okay... we could... take the longest sequence, and then...
                // Well, how do we move some elements first, out of final index order?
                //  I guess we could get the count that wll be moved before each one, and the count that is before, but will be moved
                //  after, and use that to adjust to get the actual index.
                //  (And we are just moving around within nested arrays. Yes, our algorithm COULD support more, but we don't have the
                //      facilities to emit cross virtual tree moves, so... why support applying them?)
                todonext;
                // So, if we do get the longest sequence, with order preserves even considering non-moved values, then...
                //  Hmm... okay, we could... do it via neighbors?
                todonext;
                // Oh wait, we just... our current algorithm works, it just needs to be populated with non-moved values.
                //  - Except... finalIndex! Fuck... finalIndex is messing everything up, because we don't want to have to update
                //      that for all existing values if one changes...
                //      - Hmm... maybe... just iterating back until we find an elment that is final... yeah, maybe that is JUST FINE.
                */
                

                let currentNodeObj = UnionUndefined(currentOrder[insertIndex]);
                if(!currentNodeObj) {
                    debugger;
                    throw new Error(`insertIndex should always exist in currentOrder, otherwise we don't know where to insert it!`);
                }
                currentOrder.splice(insertIndex, 0, change);
                let afterNode = (
                    // Either the first dom node of the node after us
                    currentNodeObj.node.firstDomNode
                    // Or the first node after it
                    || getNextDomNode(currentNodeObj.node)
                );


                for(let i = nodesInMove.length - 1; i >= 0; i--) {
                    let nodeToInsert = nodesInMove[i];
                    parentNode.insertBefore(nodeToInsert, afterNode);
                    afterNode = nodeToInsert;
                }
            }


            // Calculate nextDomNode. We can do this from the sibling of our current lastDomNode, OR
            //  we can get the prevDomNode from prevSiblingNode and get the sibling from there OR
            //  if that doesn't work, the dom node after us is just childNodes[0] OR null
            // Everything in this function operates on the same dom level, this is just doing tree traversal
            //  of the virtual tree, so this is actually fine.
            function getNextDomNode(treeNode: RenderTreeChild): Node|null {
                let nextDomNode: Node|null = null;
                if(treeNode.lastDomNode) {
                    nextDomNode = treeNode.lastDomNode.nextSibling;
                } else {
                    let prevDomNode: ChildNode|null = null;
                    {
                        let { prevSiblingNode } = treeNode;
                        while(prevSiblingNode) {
                            if(prevSiblingNode.lastDomNode) {
                                prevDomNode = prevSiblingNode.lastDomNode;
                                break;
                            }
                            prevSiblingNode = prevSiblingNode.prevSiblingNode;
                        }
                    }
                    if(prevDomNode) {
                        // If we have no lastDomNode we are empty, so the node after the dom node before us, is after us!
                        nextDomNode = prevDomNode.nextSibling;
                    } else {
                        // If we have no previous node we are empty, and the beginning, so the first node is after us.
                        nextDomNode = parentNode.childNodes[0] || null;
                    }
                }
                return nextDomNode;
            }
        }
        if(moves.length > 0) {
            // Find the longest sequence of changes, and insert those into currentOrder, not needing to move
            //  around the dom, as they are already in order.
            let movesByOriginalIndex = moves.slice();
            sort(movesByOriginalIndex, x => x.originalIndex);

            let { longestSequence, otherSequence } = LongestSequence(movesByOriginalIndex.map(x => x.newIndex));
            let movesByNewIndex = keyBy(moves, x => x.newIndex.toString());
            let movesLongestSequence = longestSequence.map(x => movesByNewIndex[x]);
            let movesOther = otherSequence.map(x => movesByNewIndex[x]);

            for(let move of movesLongestSequence) {
                //todonext;
                // Wait, isn't this bugged? What if the currentOrder is sparse?
                // TODO: We should call insertNode for all of them, BUT, if the previous node in the dom has already been
                //  put in currentOrder, and is supposed to be the index directly before us... then just noop.
                insertIntoListMapped(currentOrder, move, x => x.newIndex, (a, b) => a - b);
            }
            
            // Start from the end, that way we always have an element to insert before OR
            //  we are the last element. Actually... this order might not matter...
            //sort(movesOther, x => -x.newIndex);
            for(let move of movesOther) {
                insertNode(move);
            }
        }

        //  4) Add new nodes
        for(let insertion of insertions) {
            insertNode(insertion);
        }
    }

    //mark("mount2_transform", true);

    //  5) Take the children property of the jsx of all the elements we created and call Mount2 with that property as the new jsx

    for(let removedTreeLeaf of removedNestedTreeLeafs) {
        // TODO: We only need to call this so onRemoveComponent gets called, so we should realy add a special path to allow this,
        //  that doesn't do all the extra work.
        mount2Internal(removedTreeLeaf.childNode, context,
            {
                rootJSX: null,
                treeNodes: {},
                parentComponent: undefined,
            },
            XSSComponentCheck
        );
    }

    for(let nestedTreeLeaf of addedOrMovedNestedTreeLeafs) {
        let nestedJSX = nestedTreeLeaf.jsx;
        if(isPrimitive(nestedJSX)) {
            throw new Error(`Impossible, should only be added to addedOrMovedNestedTreeLeafs if it is from an object.`);
        }

        let childMountContext = nestedTreeLeaf.childNode[mountContextSymbol];
        if(!childMountContext) {
            console.error(`Impossible, child has no mount context?`);
            continue;
        }
        
        mount2Internal(
            nestedTreeLeaf.childNode,
            childMountContext,
            {
                rootJSX: nestedJSX.props.children,
                treeNodes: {},
                parentComponent: nestedTreeLeaf.component
            },
            XSSComponentCheck
        );
    }

    //mark("mount2_transform", true);
}