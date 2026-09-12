const next = require('next');
const { createServer } = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const dev = process.env.NODE_ENV !== 'production';
const hostname = '0.0.0.0';
const port = Number(process.env.PORT) || 3000;
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();
const publicIndexPath = path.join(__dirname, 'public', 'index.html');

app.prepare().then(() => {
  const httpServer = createServer((request, response) => {
    if (request.url === '/' || request.url === '/index.html') {
      fs.readFile(publicIndexPath, 'utf8', (error, html) => {
        if (error) {
          console.error('public/index.html 읽기 실패:', error);
          response.statusCode = 500;
          response.end('Internal Server Error');
          return;
        }

        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end(html);
      });
      return;
    }

    handle(request, response);
  });

  const io = new Server(httpServer);

  io.on('connection', (socket) => {
    console.log('사용자 접속');

    socket.on('chat message', (message) => {
      if (typeof message === 'string' && message.trim()) {
        io.emit('chat message', message.trim());
      }
    });

    socket.on('disconnect', () => {
      console.log('사용자 연결 종료');
    });
  });

  httpServer
    .once('error', (error) => {
      console.error(error);
      process.exit(1);
    })
    .listen(port, () => {
      console.log(`Next.js 서버 실행: http://${hostname}:${port}`);
    });
});