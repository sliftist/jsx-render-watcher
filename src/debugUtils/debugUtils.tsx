import * as preact from "preact";
import { DebugUtils } from "./debugUtilsMain";
import { connectToDebugUtils } from "./exposeDebug";

export let page = (
    <html>
        <head>
            <link rel="icon" type="image/png" href="/favicon.ico" />
            <meta name="viewport" content="initial-scale=1,user-scalable=yes,width=device-width" />
            {Object.values((new Function("return this")()).styleTags || {}).map((style: any) => (
                // Have to use dangerouslySetInnerHTML, otherwise "" (quotation marks) will be escaped.
                //  It is our own CSS anyway, so this should be safe...
                <style dangerouslySetInnerHTML={{__html: style}}></style>
            ))}
        </head>
        <body>
            <div>
                {<DebugUtils />}
            </div>
            <script type="application/javascript" src="./debugUtils.js" defer></script>
        </body>
    </html>
);

connectToDebugUtils();

if(typeof window !== "undefined") {
    preact.render(page, document);
}
