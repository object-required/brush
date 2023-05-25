default: deps generate

deps:
	npm install

generate: clean
	node src/main.js

clean:
	rm -rf dist/*
	cp -r public/* dist/

publish: generate
	npx surge dist/ --domain https://yip.fm
