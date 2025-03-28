FROM node

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

RUN mkdir -p data

CMD ["node", "index.js"]
