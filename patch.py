with open("server/routes/__tests__/workouts.test.ts", "r") as f:
    content = f.read()

content = content.replace("});\n\n\n});", "});\n")

with open("server/routes/__tests__/workouts.test.ts", "w") as f:
    f.write(content)
