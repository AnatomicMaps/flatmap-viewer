#!bin/sh

# We want directories to have a mode of 755
umask 022

# Copy oxigraph into assets
mkdir -p ./src/assets/oxigraph
cp -p ./node_modules/oxigraph/web* ./src/assets/oxigraph
