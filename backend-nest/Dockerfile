FROM node:lts-bullseye

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

# RUN npm run build


ENTRYPOINT [ "npm", "run", "start:dev" ]