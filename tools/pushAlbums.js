const mongoose = require('mongoose');
mongoose.connect(`mongodb://localhost:27017/thmix`, {
  useNewUrlParser: true, useUnifiedTopology: true, useCreateIndex: true,
});
mongoose.set('useFindAndModify', false);

const albums = require('../res/touhouAlbums');
const songs = require('../res/touhouSongs');

const {Album, Song, Midi, Person} = require('../src/models');

(async () => {
  await new Promise((resolve) => setTimeout(resolve, 1000));

  for (let i = 0; i < albums.length; i++) {
    const album = albums[i];

    const doc = await Album.findOne({index: album.index});
    if (!doc) {
      // New album
      // console.log('new album', album.name);
      await Album.create(album);
    } else {
      // Update album
      // console.log('update album', album.name);
      await Album.findByIdAndUpdate(doc._id, album);
    }
  }

  let zunDoc = await Person.findOne({name: 'ZUN'});
  if (!zunDoc) {
    zunDoc = await Person.create({name: 'ZUN'});
  }

  for (let i = 0; i < songs.length; i++) {
    const song = songs[i];

    const composerDoc = await Person.findOne({name: 'ZUN'});
    const albumDoc = await Album.findOne({index: song.albumIndex});
    let doc = await Song.findOne({
      albumIndex: song.albumIndex, track: song.track});
    if (!doc) {
      // New song
      // console.log('new song', song.name);
      doc = await Song.create({
        ...song,
        albumId: albumDoc._id,
        composerId: composerDoc._id,
      });
    } else {
      // Update song
      // console.log('update song', song.name);
      doc = await Song.findByIdAndUpdate(doc._id, {
        ...song,
        albumId: albumDoc._id,
      });
    }

    const midis = await Midi.find({
      touhouAlbumIndex: song.albumIndex, touhouSongIndex: song.track});
    for (let j = 0; j < midis.length; j++) {
      const midi = midis[j];
      // console.log('update midi', midi.name);
      await Midi.findByIdAndUpdate(midi._id, {
        songId: doc._id,
      });
    }
  }
})();
