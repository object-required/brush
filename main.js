const fs = require('fs').promises;
const path = require('path');
const openpgp = require('openpgp');
const pug = require('pug');

const DIST_DIR = 'dist';

const indexTemplate = pug.compileFile('templates/index.pug', {
  pretty: true,
});

const postTemplate = pug.compileFile('templates/post.pug', {
  pretty: true,
});

async function readDir(dirPath) {
  const files = await fs.readdir(dirPath);
  const filePaths = [];

  for (const file of files) {
    const filePath = path.join(dirPath, file);
    const stat = await fs.stat(filePath);

    if (stat.isFile()) {
      filePaths.push(filePath);
    } else if (stat.isDirectory()) {
      filePaths.push(...readDir(filePath));
    }
  }

  return filePaths;
}

async function readPublicKeys(filePaths) {
  return Promise.all(
    filePaths.map(async (filePath) => {
      const publicKeyArmored = await fs.readFile(filePath, 'utf-8');
      const publicKey = await openpgp.readKey({ armoredKey: publicKeyArmored });

      return publicKey;
    })
  );
}

async function main(directory) {
  const entries = await readDir(path.join(directory, 'posts'));
  const publicKeys = await readDir(path.join(directory, 'public_keys'));

  const verificationKeys = await readPublicKeys(publicKeys);

  const verificationKeyToUserMap = await verificationKeys.reduce(async (acc, key) => {
    const { name, email } = (await key.getPrimaryUser()).user.userID

    return {
      ...acc,
      [key.getKeyID().toHex()]: {
        name,
        email,
      }
    }
  }, {});

  const content = await Promise.all(entries.map(async (entry) => {
    const content = await fs.readFile(entry, 'utf-8');
    const signedMessage = await openpgp.readCleartextMessage({ cleartextMessage: content });
    const verificationResult = await openpgp.verify({ message: signedMessage, verificationKeys });

    const { verified, keyID, signature } = verificationResult.signatures[0];

    await verified;
    const signatureData = await signature

    const baseName = path.basename(entry);
    const fileName = baseName.split('.')[0];

    return ({
      content,
      plain: signedMessage.getText(),
      verified: true,
      signee: verificationKeyToUserMap[keyID.toHex()],
      date: signatureData.packets[0].created,
      files: {
        source: entry,
        fileName,
        textName: baseName,
        htmlName: `${fileName}.html`,
      }
    })
  }))

  content.sort((a, b) => b.date - a.date)

  await fs.writeFile(path.join(__dirname, DIST_DIR, 'index.html'), indexTemplate({
    posts: content.map(post => post.files)
  }));

  content.forEach(async (post, i) => {
    await fs.copyFile(post.files.source, path.join(__dirname, DIST_DIR, post.files.textName));

    const textLines = post.plain.split(/\r?\n/);
    const contentRows = post.content.split(/\r?\n/);

    await fs.writeFile(path.join(__dirname, DIST_DIR, post.files.htmlName), postTemplate({
      title: post.files.fileName,
      signee: post.signee,
      dateISO: post.date.toISOString(),
      date: post.date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        hour12: true,
      }),
      content: {
        prefix: contentRows.slice(0, 3).join('\n'),
        text: contentRows.slice(3, 3 + textLines.length).join('\n'),
        postfix: contentRows.slice(3 + textLines.length).join('\n'),
      },
      previous: content[i + 1]?.files,
      next: content[i - 1]?.files,
      textName: post.files.textName,
    }))
  })
}

main(path.join(__dirname, 'content'));
