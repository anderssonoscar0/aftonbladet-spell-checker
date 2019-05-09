FROM node:10.15.3-stretch-slim


WORKDIR /usr/src/app


COPY package*.json ./
COPY config.js ./
RUN npm install


COPY . .

CMD [ "npm", "start" ]
