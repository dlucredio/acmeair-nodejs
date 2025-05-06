FROM node:slim

WORKDIR /home/node/app

# Let's first install the packages (to better cache layers)
COPY package*.json ./
RUN npm install

# Now we can copy the rest (ignoring content from .dockerignore)
COPY . .

# 9080 is the app
EXPOSE 9080


# Use the following environment variable to define datasource location
ENV MONGO_URL mongodb://mongo:27017/acmeair
#ENV CLOUDANT_URL

ENTRYPOINT [ "node", "app.js"]
