with open("patch.diff", "r") as f:
    diff = f.read()

search = diff.split("<<<<<<< SEARCH")[1].split("=======")[0].strip('\n')
replace = diff.split("=======")[1].split(">>>>>>> REPLACE")[0].strip('\n')

with open("app/src/main/java/com/arc/ArcWorker.kt", "r") as f:
    content = f.read()

content = content.replace(search, replace)

with open("app/src/main/java/com/arc/ArcWorker.kt", "w") as f:
    f.write(content)
