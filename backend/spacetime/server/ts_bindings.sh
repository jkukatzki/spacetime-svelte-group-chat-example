cd ..
spacetime generate --lang typescript --out-dir client/src/module_bindings --project-path server
cd client/src/module_bindings
mv * ../../../../../frontend/src/lib/components/spacetime/module_bindings
rm -rf client/src/module_bindings