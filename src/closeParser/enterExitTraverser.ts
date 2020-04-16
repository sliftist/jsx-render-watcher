import { Node } from "@typescript-eslint/typescript-estree/dist/ts-estree/ts-estree";
import { visitorKeys } from "@typescript-eslint/typescript-estree";

// Modified from https://github.com/typescript-eslint/typescript-eslint/blob/835378e505f462d965ce35cc4c81f8eee1704a30/packages/typescript-estree/src/simple-traverse.ts
export class EnterExitTraverser {
    constructor(private options: {
		enter: (statement: Node, parent?: Node, property?: string) => boolean|void;
		exit: (statement: Node, parent?: Node, property?: string) => void;
	}) { }
	private isValidNode(x: Node) {
		return x && typeof x === 'object' && typeof x.type === 'string';
	}
	private getVisitorKeysForNode(node: Node): (keyof Node)[] {
		const keys = visitorKeys[node.type];
		return keys !== null && keys !== void 0 ? keys : [] as any;
	}
    public traverse(node: Node, parent?: Node, property?: keyof Node) {
        if (!this.isValidNode(node)) {
            return;
        }
		try {
			if(this.options.enter(node, parent, property) === false) {
				return;
			}
			const keys = this.getVisitorKeysForNode(node);
			if (keys.length < 1) {
				return;
			}
			for (const key of keys) {
				const childOrChildren = node[key];
				if (Array.isArray(childOrChildren)) {
					for (const child of childOrChildren) {
						this.traverse(child as any, node, key);
					}
				}
				else {
					this.traverse(childOrChildren as any, node, key);
				}
			}
		} finally {
			this.options.exit(node, parent, property);
		}
    }
}
