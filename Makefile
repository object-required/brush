default: build

deps:
	npm install

build: deps clean
	node main.js

clean:
	rm -rf dist/*
	cp -r public/* dist/

publish: build
	npx surge dist/ --domain https://yip.fm
