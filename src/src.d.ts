
type DeepReadonly<T> = {
    readonly [P in keyof T]: DeepReadonly<T[P]>;
};

declare namespace EyeTypes {
    type Path2 = DeepReadonly<{
        /** The access path. */
        path: (string|Symbol|number)[];
        /** Paths hashes are comparable via regular comparison operators. Also, the root path is truthy, and we can get the parent of a path without
         *      having to worry about escape characters, so path navigation is relatively fast.
         */
        pathHash: string;
    }>;
}

declare let x: number;
interface Window {
    __exposeDebugLookupDebugger?: <T extends { [key in PropertyKey]: unknown }>(lookup: T, name: string) => T;
}