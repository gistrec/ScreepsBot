module.exports = function(grunt) {
    grunt.loadNpmTasks('grunt-screeps');
    grunt.loadNpmTasks('grunt-contrib-clean')
    grunt.loadNpmTasks('grunt-contrib-copy')

    grunt.initConfig({
        screeps: {
            options: {
                email: process.env.SCREEPS_EMAIL,
                token: process.env.SCREEPS_TOKEN,
                branch: 'default',
            },
            dist: {
                src: ['build/step_2/*']
            }
        },
        clean: {
            build: ['build']
        },
        copy: {
            // Copy all files to a temporary folder
            copy: {
                files: [{
                    expand: true,
                    cwd: 'default/',
                    src: '**',
                    dest: 'build/step_1/',
                    filter: 'isFile',
                }],
            },
            // Rename all files to use underscores for folders
            rename: {
                files: [{
                    expand: true,
                    cwd: 'build/step_1/',
                    src: '**',
                    dest: 'build/step_2/',
                    filter: 'isFile',
                    rename: function (dest, src) {
                        // Change the path name utilize underscores for folders
                        return dest + src.replace(/\//g,'_');
                    },
                }],
            }
        }
    });

    grunt.registerTask('default',  ['clean', 'copy:copy', 'replace', 'copy:rename', 'screeps']);

    grunt.registerTask('replace', 'Replaces file paths with _', function () {
        grunt.file.recurse('./build/step_1', ReplaceImports);
    });

    let ReplaceImports = function(abspath, rootdir, subdir, filename) {
        if (abspath.match(/.js$/) == null) {
            return;
        }
        let file = grunt.file.read(abspath);
        let updatedFile = '';

        let lines = file.split('\n');
        for (let line of lines) {
            // Compiler: IgnoreLine
            if ((line).match(/[.]*\/\/ Compiler: IgnoreLine[.]*/)) {
                continue;
            }
            let reqStr = line.match(/(?:require\(')([^_a-zA-Z0-9]*)([^']*)/);
            if (reqStr && reqStr != "") {
                let reqPath = subdir ? subdir.split('/') : []; // relative path
                let upPaths = line.match(/\.\.\//gi);

                if (upPaths) {
                    for (let i in upPaths) {
                        reqPath.splice(reqPath.length - 1);
                    }
                } else {
                    let isRelative = line.match(/\.\//gi);
                    if (!isRelative || isRelative == "") {
                        // absolute path
                        reqPath = [];
                    }
                }

                let rePathed = "";
                if (reqPath && reqPath.length > 0) {
                    while (reqPath.length > 0) {

                        rePathed += reqPath.shift() + "_";
                    }
                }
                line = line.replace(/require\('([\.\/]*)([^']*)/, "require\('" + rePathed + "$2").replace(/\//gi, '_');
            }

            updatedFile += (line + '\n');
        }

        grunt.file.write((rootdir + '/' + (subdir ? subdir + '/' : '') + filename), updatedFile);
    }
}