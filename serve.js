const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");

const root = __dirname;
const port = Number(process.env.PORT) || 8765;
const types = {".html":"text/html", ".js":"text/javascript", ".css":"text/css", ".json":"application/json", ".jpg":"image/jpeg", ".png":"image/png", ".svg":"image/svg+xml"};

http.createServer((req,res)=>{
  const pathname = decodeURIComponent(new URL(req.url,"http://localhost").pathname);
  const file = path.resolve(root,`.${pathname === "/" ? "/index.html" : pathname}`);
  if(file !== root && !file.startsWith(root+path.sep)) {
    res.writeHead(403);res.end();return;
  }
  fs.createReadStream(file).on("error",()=>{res.writeHead(404);res.end();})
    .on("open",()=>res.writeHead(200,{"Content-Type":types[path.extname(file)]||"application/octet-stream","Cache-Control":"no-store"}))
    .pipe(res);
}).listen(port,"127.0.0.1",()=>{
  const url=`http://127.0.0.1:${port}`;
  console.log(`SOTN Editor v6.1: ${url}`);
  if(process.argv.includes("--open")&&process.platform==="win32"){
    execFile("cmd.exe",["/c","start","",url],{windowsHide:true},error=>{
      if(error)console.error(`Open ${url} in your browser.`);
    });
  }
}).on("error",error=>{
  console.error(error.code==="EADDRINUSE"?`Port ${port} is busy. Close the previous editor server, then try again.`:error.message);
  process.exitCode=1;
});
