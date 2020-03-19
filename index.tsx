import * as preact from "preact";
import { TestMain } from "./src/test";

export let page = (
    <html>
        <head>
            <link rel="icon" type="image/png" href="/favicon.ico" />
            <meta name="viewport" content="initial-scale=1,user-scalable=yes,width=device-width" />
            {/*Object.values(g.styleTags || {}).map((style: any) => (
                // Have to use dangerouslySetInnerHTML, otherwise "" (quotation marks) will be escaped.
                //  It is our own CSS anyway, so this should be safe...
                <style dangerouslySetInnerHTML={{__html: style}}></style>
            ))*/}
        </head>
        <body>
            <div>
                {<TestMain y={5}/>}
            </div>
            <script type="application/javascript" src="./index.js" defer></script>
            <script type="application/javascript" src="https://cdn.jsdelivr.net/gh/google/code-prettify@master/loader/run_prettify.js" defer></script>
        </body>
    </html>
);


if(typeof window !== "undefined") {
    preact.render(page, document);
}